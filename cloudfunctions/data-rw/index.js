// data-rw：所有 events 表的读写代理
// V1 严格遵循 D1：禁止前端直连 db；events 集合的 ACL 应设为 {read:false, write:false}
//
// 支持 action：
// - listEvents
// - createEvent (含 M3 24h 去重事务)
// - softDeleteEvent
// - hardDeleteEvent

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const FAMILY_ID = 'default';
// M3：period_start / period_end 去重粒度 = 同一自然日（按 occurred_at 当天）
// 之前是 24h 滑动窗口，会把"5月3日傍晚 + 5月4日上午"误判为重复

async function getMyFamilyId(openid) {
  // V1 只有 default family
  return FAMILY_ID;
}

async function listEvents(openid, args = {}) {
  const family_id = await getMyFamilyId(openid);
  let q = db
    .collection('events')
    .where({
      family_id,
      deleted_at: _.exists(false),
      ...(args.subject ? { subject: args.subject } : {}),
    })
    .orderBy('occurred_at', 'desc')
    .limit(args.limit || 200);
  const res = await q.get();
  return res.data;
}

async function createEvent(openid, input) {
  if (!input || !input.category || !input.subject) {
    throw new Error('invalid_input');
  }
  const family_id = await getMyFamilyId(openid);
  const now = new Date().toISOString();
  const occurred_at = input.occurred_at || now;

  const newEvent = {
    family_id,
    recorder_openid: openid,
    subject: input.subject,
    category: input.category,
    subtype: input.subtype,
    occurred_at,
    payload: input.payload || {},
    source: input.source || 'manual',
    batch_id: input.batch_id,
    created_at: now,
  };

  // M3：仅对 period_start / period_end 按"同一自然日"去重（基于 occurred_at 所在 day）
  if (input.category === 'period_start' || input.category === 'period_end') {
    const occ = new Date(occurred_at);
    const dayStartIso = new Date(occ.getFullYear(), occ.getMonth(), occ.getDate(), 0, 0, 0, 0).toISOString();
    const dayEndIso = new Date(occ.getFullYear(), occ.getMonth(), occ.getDate() + 1, 0, 0, 0, 0).toISOString();
    const result = await db.runTransaction(async transaction => {
      const dup = await transaction
        .collection('events')
        .where({
          family_id,
          subject: input.subject,
          category: input.category,
          deleted_at: _.exists(false),
          occurred_at: _.gte(dayStartIso).and(_.lt(dayEndIso)),
        })
        .limit(1)
        .get();
      if (dup.data && dup.data.length > 0) {
        return { deduped: true, existing_id: dup.data[0]._id, event: dup.data[0] };
      }
      const addRes = await transaction.collection('events').add({ data: newEvent });
      return { deduped: false, event: { ...newEvent, _id: addRes._id } };
    });
    return result;
  }

  const addRes = await db.collection('events').add({ data: newEvent });
  return { deduped: false, event: { ...newEvent, _id: addRes._id } };
}

async function softDeleteEvent(openid, event_id) {
  const family_id = await getMyFamilyId(openid);
  const target = (await db.collection('events').doc(event_id).get()).data;
  if (!target || target.family_id !== family_id) {
    throw new Error('not_found');
  }
  if (target.recorder_openid !== openid) {
    throw new Error('only_owner_can_delete');
  }
  await db
    .collection('events')
    .doc(event_id)
    .update({ data: { deleted_at: new Date().toISOString() } });
  return true;
}

async function hardDeleteEvent(openid, event_id) {
  const family_id = await getMyFamilyId(openid);
  const target = (await db.collection('events').doc(event_id).get()).data;
  if (!target || target.family_id !== family_id) {
    throw new Error('not_found');
  }
  if (target.recorder_openid !== openid) {
    throw new Error('only_owner_can_delete');
  }
  await db.collection('events').doc(event_id).remove();
  return true;
}

exports.main = async event => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { ok: false, error: 'no_openid' };

  const action = event.action;
  try {
    switch (action) {
      case 'listEvents': {
        const data = await listEvents(OPENID, { subject: event.subject, limit: event.limit });
        return { ok: true, data };
      }
      case 'createEvent': {
        const data = await createEvent(OPENID, event.input);
        return { ok: true, data, deduped: data.deduped, existing_id: data.existing_id };
      }
      case 'softDeleteEvent': {
        const data = await softDeleteEvent(OPENID, event.event_id);
        return { ok: true, data };
      }
      case 'hardDeleteEvent': {
        const data = await hardDeleteEvent(OPENID, event.event_id);
        return { ok: true, data };
      }
      default:
        return { ok: false, error: 'unknown_action' };
    }
  } catch (e) {
    console.error('[data-rw] error', e);
    return { ok: false, error: e.message || String(e) };
  }
};
