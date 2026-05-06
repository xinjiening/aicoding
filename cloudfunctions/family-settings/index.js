// family-settings：写家庭级别的偏好（角色映射 / 手动平均周期）
// 严格遵循 D1：前端不直读 families，所有写入都走云函数（caller 必须有 OPENID）
//
// actions:
//   setRole              { role: 'husband' | 'wife' }              → family.roles[OPENID] = role
//   setManualAvgCycle    { days: number(18..60) }                  → family.manual_avg_cycle_days
//   clearManualAvgCycle  {}                                        → family.manual_avg_cycle_days = null
//
// 安全约束：调用者必须已是 family.members 的一员。否则禁止写入。

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const FAMILY_ID = 'default';
const VALID_ROLES = ['husband', 'wife'];
const MIN_CYCLE = 18;
const MAX_CYCLE = 60;

function err(code) {
  return { ok: false, error: code };
}

async function loadFamily() {
  try {
    return (await db.collection('families').doc(FAMILY_ID).get()).data;
  } catch (_e) {
    return null;
  }
}

function isMember(family, openid) {
  if (!family) return false;
  if (family.created_by === openid) return true;
  return Array.isArray(family.members) && family.members.includes(openid);
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return err('no_openid');

  const action = event && event.action;
  if (!action) return err('missing_action');

  const family = await loadFamily();
  if (!family) return err('family_not_found_call_whoami_first');
  if (!isMember(family, OPENID)) return err('not_a_member');

  const families = db.collection('families');

  if (action === 'setRole') {
    const role = event.role;
    if (!VALID_ROLES.includes(role)) return err('invalid_role');
    // 不用 dot-path，直接读出来再整体写回（更兼容旧 doc / 字段不存在的情况）
    const nextRoles = Object.assign({}, family.roles || {}, { [OPENID]: role });
    await families.doc(FAMILY_ID).update({
      data: { roles: nextRoles },
    });
    return {
      ok: true,
      data: { openid: OPENID, role, role_manually_set: true },
    };
  }

  if (action === 'setManualAvgCycle') {
    const days = Number(event.days);
    if (!Number.isFinite(days) || !Number.isInteger(days) || days < MIN_CYCLE || days > MAX_CYCLE) {
      return err('invalid_days');
    }
    await families.doc(FAMILY_ID).update({
      data: { manual_avg_cycle_days: days },
    });
    return { ok: true, data: { manual_avg_cycle_days: days } };
  }

  if (action === 'clearManualAvgCycle') {
    await families.doc(FAMILY_ID).update({
      data: { manual_avg_cycle_days: null },
    });
    return { ok: true, data: { manual_avg_cycle_days: null } };
  }

  return err('unknown_action');
};
