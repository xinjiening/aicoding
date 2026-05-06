import { api } from '../../utils/api';
import { calculatePeriodStats, daysBetween } from '../../utils/period';
import { dateGroupLabel, fmtTime, fmtYMD, ymd } from '../../utils/format';
import { recorderLabel, canSoftDelete } from '../../utils/auth';
import type { AppEvent, PeriodStats, UserInfo } from '../../types/event';

interface ListItemVM {
  id: string;
  category: string;
  badge: string;
  isSelf: boolean;
  timeLabel: string;
  text: string;
  canDelete: boolean;
  dateKey: string;
}

interface GroupVM {
  dateKey: string;
  dateLabel: string;
  items: ListItemVM[];
}

interface CycleNoteVM {
  id: string;
  dateLabel: string;   // 5月6日
  timeLabel: string;   // 14:30
  text: string;
}

interface CycleVM {
  id: string;
  startDate: string;            // YYYY-MM-DD
  startLabel: string;           // 26年5月6日
  endDate: string | null;       // YYYY-MM-DD
  endLabel: string;             // 26年5月10日 / 未结束
  durationLabel: string;        // 4 天 / 进行中第 X 天
  ongoing: boolean;
  notes: CycleNoteVM[];
  expanded: boolean;
}

const app = getApp<IAppOption>();

Page({
  data: {
    loading: true,
    user: null as UserInfo | null,
    events: [] as AppEvent[],
    stats: null as PeriodStats | null,
    groups: [] as GroupVM[],
    cycles: [] as CycleVM[],
    activeTab: 'note' as 'note' | 'cycle',
    expandedCycleIds: {} as Record<string, boolean>,
    todayStr: '',
    predictedNextStart: '',
  },

  onLoad() {
    this.setData({ todayStr: ymd(new Date()) });
    this.refresh();
  },
  onShow() {
    this.refresh();
  },

  async refresh() {
    this.setData({ loading: true });
    try {
      const [user, events] = await Promise.all([api.whoami(), api.listEvents({ subject: 'wife' })]);
      const stats = calculatePeriodStats(events);
      const items = events.map(e => this.toItemVM(e, user));
      const cycles = buildCycles(events, this.data.expandedCycleIds);
      this.setData({
        user,
        events,
        stats,
        predictedNextStart: stats.predictedNextStart || '',
        groups: groupByDate(items),
        cycles,
      });
    } catch (e) {
      console.warn('[period] refresh failed', e);
    } finally {
      this.setData({ loading: false });
    }
  },

  toItemVM(e: AppEvent, me: UserInfo): ListItemVM {
    return {
      id: e._id,
      category: e.category,
      badge: recorderLabel(e.recorder_openid, me),
      isSelf: e.recorder_openid === me.openid,
      timeLabel: fmtTime(e.occurred_at),
      text: describeEvent(e),
      canDelete: canSoftDelete(e.recorder_openid, me),
      dateKey: ymd(new Date(e.occurred_at)),
    };
  },

  onTabChange(e: WechatMiniprogram.TouchEvent) {
    const tab = (e.currentTarget.dataset as { tab: 'note' | 'cycle' }).tab;
    this.setData({ activeTab: tab });
  },

  onToggleCycle(e: WechatMiniprogram.TouchEvent) {
    const id = (e.currentTarget.dataset as { id: string }).id;
    const next = { ...this.data.expandedCycleIds };
    next[id] = !next[id];
    const cycles = this.data.cycles.map(c => (c.id === id ? { ...c, expanded: !c.expanded } : c));
    this.setData({ expandedCycleIds: next, cycles });
  },

  /** 给「未结束」的周期补一个 period_end */
  async onSetEndDate(e: WechatMiniprogram.PickerChange) {
    const dataset = e.currentTarget.dataset as { startDate: string };
    const dateStr = String(e.detail.value);
    if (dateStr < dataset.startDate) {
      wx.showToast({ icon: 'none', title: '结束时间不能早于开始' });
      return;
    }
    const d = new Date(dateStr);
    d.setHours(12, 0, 0, 0);
    try {
      const result = await api.createEvent({
        subject: 'wife',
        category: 'period_end',
        payload: { is_estimated: false },
        occurred_at: d.toISOString(),
        source: 'manual',
      });
      if (result.deduped) {
        wx.showToast({ icon: 'none', title: '这一天已经记过啦' });
      } else {
        wx.showToast({ icon: 'success', title: '已记录结束时间' });
      }
      this.refresh();
    } catch (err) {
      console.warn('[period] set end failed', err);
      wx.showToast({ icon: 'none', title: '记录失败' });
    }
  },

  /** 日历点了某天 → 弹底部菜单 */
  async onCalendarTap(e: WechatMiniprogram.CustomEvent<{ date?: string }>) {
    const date = e.detail && e.detail.date;
    if (!date) return; // 防御：日历偶发会传 undefined（首次 setData 未完成）
    const todayKey = ymd(new Date());
    const isFuture = date > todayKey;
    const isToday = date === todayKey;
    const labelDate = isToday
      ? '今天'
      : date === ymdAddDays(todayKey, -1)
      ? '昨天'
      : prettyDateLabel(date);

    const itemList = isFuture
      ? ['记一笔']
      : [`${labelDate}来了`, `${labelDate}结束`, '记一笔'];

    let res: WechatMiniprogram.ShowActionSheetSuccessCallbackResult;
    try {
      res = await wx.showActionSheet({ itemList });
    } catch {
      return;
    }

    const tapped = itemList[res.tapIndex];
    const occurredAt = isoAtNoon(date);

    if (tapped === '记一笔') {
      app.globalData.pendingRecordDate = date;
      wx.switchTab({ url: '/pages/record/record' });
      return;
    }

    if (tapped.endsWith('来了')) {
      await this.submitMark('period_start', occurredAt, '已记录「来了」');
    } else if (tapped.endsWith('结束')) {
      await this.submitMark('period_end', occurredAt, '已记录「结束了」');
    }
  },

  async submitMark(category: 'period_start' | 'period_end', occurredAt: string, okMsg: string) {
    try {
      const result = await api.createEvent({
        subject: 'wife',
        category,
        payload: category === 'period_start'
          ? { is_estimated: false, expected_end_offset_days: 5 }
          : { is_estimated: false },
        occurred_at: occurredAt,
        source: 'manual',
      });
      if (result.deduped) {
        wx.showToast({ icon: 'none', title: '这一天已经记过啦' });
      } else {
        wx.showToast({ icon: 'success', title: okMsg });
      }
      this.refresh();
    } catch (e) {
      console.warn('[period] submitMark failed', e);
      wx.showToast({ icon: 'none', title: '记录失败' });
    }
  },

  async onLongPressItem(e: WechatMiniprogram.TouchEvent) {
    const id = (e.currentTarget.dataset as { id: string }).id;
    const item = this.findItem(id);
    if (!item) return;
    if (!item.canDelete) {
      wx.showToast({ icon: 'none', title: '只能删自己记的' });
      return;
    }
    const confirm = await wx.showModal({
      title: '确认删除？',
      content: '软删除后不再显示',
      confirmText: '删除',
      cancelText: '取消',
    });
    if (!confirm.confirm) return;
    try {
      await api.softDeleteEvent(id);
      wx.showToast({ icon: 'success', title: '已删除' });
      this.refresh();
    } catch (err) {
      wx.showToast({ icon: 'none', title: '删除失败' });
    }
  },

  findItem(id: string): ListItemVM | undefined {
    for (const g of this.data.groups) {
      const hit = g.items.find(it => it.id === id);
      if (hit) return hit;
    }
    return undefined;
  },
});

function describeEvent(e: AppEvent): string {
  switch (e.category) {
    case 'period_start': return '🌹 来了';
    case 'period_end': return '✅ 这次结束了';
    case 'symptom': {
      const map: Record<string, string> = {
        cramp: '腹痛', headache: '头痛', fatigue: '疲倦', nausea: '恶心', low_back_pain: '腰酸',
      };
      const sev = (e.payload as { severity?: number; note?: string }).severity;
      const label = map[e.subtype || ''] || '不适';
      const note = (e.payload as { note?: string }).note;
      return `${label}${sev ? ` · ${sev}/5` : ''}${note ? ` · ${note}` : ''}`;
    }
    case 'flow': {
      const m: Record<string, string> = { light: '少', medium: '中', heavy: '多' };
      return `流量：${m[e.subtype || 'medium']}`;
    }
    case 'note': return (e.payload as { text?: string }).text || '备注';
    default: return '记录';
  }
}

function groupByDate(items: ListItemVM[]): GroupVM[] {
  const groups: GroupVM[] = [];
  for (const it of items) {
    const last = groups[groups.length - 1];
    if (last && last.dateKey === it.dateKey) {
      last.items.push(it);
    } else {
      groups.push({
        dateKey: it.dateKey,
        dateLabel: dateGroupLabel(it.dateKey + 'T12:00:00'),
        items: [it],
      });
    }
  }
  return groups;
}

/**
 * 把 events 配对成 cycle：每个 period_start 找下一个 period_end（且必须在下一个 start 之前）。
 * 同时把这一周期窗口内的 symptom/flow/note 挂在该 cycle.notes 上。
 * 输出按"最新在前"倒序。
 */
function buildCycles(events: AppEvent[], expandedMap: Record<string, boolean>): CycleVM[] {
  const valid = events.filter(e => !e.deleted_at && e.subject === 'wife');
  const startsAsc = valid
    .filter(e => e.category === 'period_start')
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  const endsAsc = valid
    .filter(e => e.category === 'period_end')
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  const noteEvents = valid.filter(e =>
    e.category === 'symptom' || e.category === 'flow' || e.category === 'note',
  );

  const usedEnds = new Set<string>();
  const cycles: CycleVM[] = [];

  for (let i = 0; i < startsAsc.length; i++) {
    const start = startsAsc[i];
    const next = startsAsc[i + 1];
    const startTs = new Date(start.occurred_at).getTime();
    const nextTs = next ? new Date(next.occurred_at).getTime() : Infinity;

    // 取窗口 [start, nextStart) 内第一个未被占用的 end
    const matchedEnd = endsAsc.find(e => {
      if (usedEnds.has(e._id)) return false;
      const ts = new Date(e.occurred_at).getTime();
      return ts >= startTs && ts < nextTs;
    });
    if (matchedEnd) usedEnds.add(matchedEnd._id);

    const ongoing = !matchedEnd && !next;
    const windowEndTs = matchedEnd
      ? new Date(matchedEnd.occurred_at).getTime() + 86400000 // end 当天的备注也算这次
      : (next ? nextTs : Date.now());

    // 挑窗口内的备注，倒序
    const notes: CycleNoteVM[] = noteEvents
      .filter(e => {
        const ts = new Date(e.occurred_at).getTime();
        return ts >= startTs && ts <= windowEndTs;
      })
      .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
      .map(e => ({
        id: e._id,
        dateLabel: dateGroupLabel(e.occurred_at),
        timeLabel: fmtTime(e.occurred_at),
        text: describeEvent(e),
      }));

    let durationLabel: string;
    if (matchedEnd) {
      const days = daysBetween(matchedEnd.occurred_at, start.occurred_at) + 1;
      durationLabel = `${days} 天`;
    } else if (ongoing) {
      const days = daysBetween(new Date(), start.occurred_at) + 1;
      durationLabel = `进行中 · 第 ${days} 天`;
    } else {
      // 没 end 但已有下个 start —— 历史漏记
      durationLabel = '未记结束时间';
    }

    cycles.push({
      id: start._id,
      startDate: ymd(new Date(start.occurred_at)),
      startLabel: fmtYMD(start.occurred_at),
      endDate: matchedEnd ? ymd(new Date(matchedEnd.occurred_at)) : null,
      endLabel: matchedEnd ? fmtYMD(matchedEnd.occurred_at) : (ongoing ? '未结束' : '未记结束'),
      durationLabel,
      ongoing,
      notes,
      expanded: !!expandedMap[start._id],
    });
  }

  return cycles.reverse();
}

function isoAtNoon(date: string): string {
  const d = new Date(date);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}

function ymdAddDays(base: string, days: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return ymd(d);
}

/** YYYY-MM-DD → "5月3日" */
function prettyDateLabel(ymdStr: string): string {
  const [, m, d] = ymdStr.split('-');
  return `${parseInt(m, 10)}月${parseInt(d, 10)}日`;
}
