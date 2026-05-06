// home-bundle：首屏一次性返回 { user, events, stats }
// 内部并行 await whoami + listEvents + computeStats
// 减少首屏 3 次往返为 1 次

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const FAMILY_ID = 'default';
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const AVG_CYCLE_FALLBACK_DAYS = 28;
const AVG_CYCLE_MIN_DAYS = 18;
const AVG_CYCLE_MAX_DAYS = 60;

function daysBetween(later, earlier) {
  return Math.floor((new Date(later).getTime() - new Date(earlier).getTime()) / ONE_DAY_MS);
}

function median(nums) {
  if (nums.length === 0) return NaN;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}

function calculatePeriodStats(events) {
  const valid = events.filter(e => !e.deleted_at);
  const periodStarts = valid
    .filter(e => e.category === 'period_start')
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  const periodEnds = valid
    .filter(e => e.category === 'period_end')
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));

  if (periodStarts.length === 0) {
    return {
      lastStart: null,
      daysSince: null,
      avgCycleDays: null,
      predictedNextStart: null,
      lastDurationDays: null,
      inProgress: false,
      totalCycles: 0,
    };
  }

  const lastStart = periodStarts[0].occurred_at;
  const daysSince = daysBetween(new Date().toISOString(), lastStart);
  const lastEndEvent = periodEnds.find(
    end => new Date(end.occurred_at).getTime() > new Date(lastStart).getTime(),
  );
  const lastEnd = lastEndEvent ? lastEndEvent.occurred_at : null;
  const inProgress = !lastEnd;
  const lastDurationDays = lastEnd ? Math.max(1, daysBetween(lastEnd, lastStart) + 1) : null;

  if (periodStarts.length === 1) {
    return {
      lastStart,
      daysSince,
      avgCycleDays: null,
      predictedNextStart: null,
      lastDurationDays,
      inProgress,
      totalCycles: 1,
    };
  }

  const asc = [...periodStarts].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  const intervals = [];
  for (let i = 1; i < asc.length; i++) {
    const gap = daysBetween(asc[i].occurred_at, asc[i - 1].occurred_at);
    if (gap >= AVG_CYCLE_MIN_DAYS && gap <= AVG_CYCLE_MAX_DAYS) intervals.push(gap);
  }

  let avgCycleDays;
  if (intervals.length === 0) {
    avgCycleDays = AVG_CYCLE_FALLBACK_DAYS;
  } else if (intervals.length <= 2) {
    avgCycleDays = Math.round(intervals.reduce((s, n) => s + n, 0) / intervals.length);
  } else {
    avgCycleDays = Math.round(median(intervals.slice(-6)));
  }

  const predictedNextStart = new Date(
    new Date(lastStart).getTime() + avgCycleDays * ONE_DAY_MS,
  ).toISOString();

  return {
    lastStart,
    daysSince,
    avgCycleDays,
    predictedNextStart,
    lastDurationDays,
    inProgress,
    totalCycles: periodStarts.length,
  };
}

async function ensureFamilyMembership(openid) {
  const families = db.collection('families');
  const now = new Date().toISOString();
  let family;
  try {
    family = (await families.doc(FAMILY_ID).get()).data;
  } catch (_e) {
    family = null;
  }
  if (!family) {
    try {
      await families.add({
        data: {
          _id: FAMILY_ID,
          name: '我们家',
          created_at: now,
          created_by: openid,
          members: [openid],
        },
      });
      family = { _id: FAMILY_ID, created_by: openid, members: [openid] };
    } catch (_e) {
      family = (await families.doc(FAMILY_ID).get()).data;
    }
  }
  if (family && !(family.members || []).includes(openid)) {
    await families.doc(FAMILY_ID).update({ data: { members: _.addToSet(openid) } });
    family.members = [...(family.members || []), openid];
  }
  let role = 'unknown';
  if (family.created_by === openid) role = 'husband';
  else if ((family.members || []).includes(openid)) role = 'wife';
  return { openid, family_id: FAMILY_ID, role };
}

exports.main = async () => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { ok: false, error: 'no_openid' };

  try {
    const [user, eventsRes] = await Promise.all([
      ensureFamilyMembership(OPENID),
      db
        .collection('events')
        .where({
          family_id: FAMILY_ID,
          subject: 'wife',
          deleted_at: _.exists(false),
        })
        .orderBy('occurred_at', 'desc')
        .limit(200)
        .get(),
    ]);

    const events = eventsRes.data;
    const stats = calculatePeriodStats(events);

    return { ok: true, data: { user, events, stats } };
  } catch (e) {
    console.error('[home-bundle] error', e);
    return { ok: false, error: e.message || String(e) };
  }
};
