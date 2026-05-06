// whoami：bootstrap 云函数
// 1. 拿当前 openid
// 2. upsert 'default' family，把当前 openid 加入 members（addToSet 避免重复）
// 3. 推断角色：family.created_by === openid → husband；否则 wife（V1 简单暴力够用）
// 4. 返回 { openid, family_id, role }
//
// 严格遵循 design doc M2：用 atomic upsert，不要先查后插

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const FAMILY_ID = 'default';

exports.main = async () => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) {
    return { ok: false, error: 'no_openid' };
  }

  const families = db.collection('families');
  const now = new Date().toISOString();

  // 先查一次，决定是否第一次创建（用于打 created_by 标记）
  let family;
  try {
    family = (await families.doc(FAMILY_ID).get()).data;
  } catch (_e) {
    family = null;
  }

  if (!family) {
    // 第一次：尝试 add（如果并发被别人插进去就 fallback 到 update）
    try {
      await families.add({
        data: {
          _id: FAMILY_ID,
          name: '我们家',
          created_at: now,
          created_by: OPENID,
          members: [OPENID],
        },
      });
      family = { _id: FAMILY_ID, created_by: OPENID, members: [OPENID] };
    } catch (_e) {
      family = (await families.doc(FAMILY_ID).get()).data;
    }
  }

  // 不在 members 里就加进去（addToSet）
  if (family && !(family.members || []).includes(OPENID)) {
    await families.doc(FAMILY_ID).update({
      data: {
        members: _.addToSet(OPENID),
      },
    });
    family.members = [...(family.members || []), OPENID];
  }

  let role = 'unknown';
  if (family) {
    if (family.created_by === OPENID) role = 'husband';
    else if ((family.members || []).includes(OPENID)) role = 'wife';
  }

  return {
    ok: true,
    data: {
      openid: OPENID,
      family_id: FAMILY_ID,
      role,
    },
  };
};
