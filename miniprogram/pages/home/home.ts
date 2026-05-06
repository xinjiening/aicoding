import { api } from '../../utils/api';
import { calculatePeriodStats, daysBetween, describeNext, daysUntilPredicted } from '../../utils/period';
import { dateGroupLabel, fmtMonthDay, fmtTime, fmtYMD, ymd } from '../../utils/format';
import { recorderLabel, canSoftDelete, nextLine } from '../../utils/auth';
import type { AppEvent, PeriodStats, UserInfo } from '../../types/event';

type MoodKey = 'happy' | 'neutral' | 'sad';

interface ListItemVM {
  id: string;
  category: string;
  badge: string;
  isSelf: boolean;
  dayLabel: string;
  timeLabel: string;
  text: string;
  canDelete: boolean;
  dateKey: string;
  selectKey: string;
}

interface GroupVM {
  dateKey: string;
  dateLabel: string;
  items: ListItemVM[];
}

interface CycleRecordVM {
  id: string;
  dateLabel: string;
  timeLabel: string;
  lines: string[];
  eventIds: string[];
  eventIdsText: string;
}

interface CycleVM {
  id: string;
  startDate: string;
  startLabel: string;
  endDate: string | null;
  endLabel: string;
  durationLabel: string;
  ongoing: boolean;
  records: CycleRecordVM[];
  recordEventIds: string[];
  recordEventIdsText: string;
  expanded: boolean;
}

const MOOD_OPTIONS: Array<{ key: MoodKey; label: string; emoji: string }> = [
  { key: 'happy', label: '开心', emoji: '🙂' },
  { key: 'neutral', label: '一般', emoji: '😐' },
  { key: 'sad', label: '难过', emoji: '🙁' },
];

const app = getApp<IAppOption>();

Page({
  data: {
    loading: true,
    isMock: false,
    user: null as UserInfo | null,
    events: [] as AppEvent[],
    stats: null as PeriodStats | null,

    // 主卡数据
    nextLineLabel: '老婆下次大姨妈',
    nextDescribe: '点「今天来了」开始',
    daysToNext: null as number | null,
    lastDateText: '—',
    lastSinceText: '',
    predictedNextText: '—',
    predictedNextStart: '',
    avgCycleText: '—',
    inProgressBadge: '',

    // 列表 / 周期
    activeTab: 'note' as 'note' | 'cycle',
    groups: [] as GroupVM[],
    cycles: [] as CycleVM[],
    expandedCycleIds: {} as Record<string, boolean>,
    batchMode: false,
    todayStr: '',

    // Undo
    pendingUndoEventId: '',
    showUndo: false,
  },

  async onLoad() {
    this.setData({ todayStr: ymd(new Date()) });
    await this.refresh();
  },

  onShow() {
    this.setData({ batchMode: !!app.globalData.batchMode });
    // 来自 record 页保存大姨妈日期后的跳转：自动切到「大姨妈」Tab，让用户立刻看到
    const pendingTab = app.globalData.pendingPeriodTab;
    if (pendingTab) {
      this.setData({ activeTab: pendingTab });
      app.globalData.pendingPeriodTab = undefined;
    }
    this.refresh();
  },

  async refresh() {
    this.setData({ loading: true, isMock: api.isMock() });
    try {
      const [user, events] = await Promise.all([
        api.whoami(),
        api.listEvents({ subject: 'wife' }),
      ]);
      const stats = calculatePeriodStats(events, user.manual_avg_cycle_days);
      const items = events
        .filter(isMoodNoteEvent)
        .map(e => this.toItemVM(e, user));
      const cycles = buildCycles(events, this.data.expandedCycleIds);
      this.setData({
        user,
        events,
        stats,
        nextLineLabel: nextLine(user.role),
        nextDescribe: describeNext(stats),
        daysToNext: daysUntilPredicted(stats.predictedNextStart),
        lastDateText: stats.lastStart ? fmtMonthDay(stats.lastStart) : '还没记录',
        lastSinceText:
          stats.daysSince === null
            ? ''
            : stats.daysSince === 0
            ? '今天'
            : `${stats.daysSince} 天前`,
        predictedNextText: stats.predictedNextStart ? fmtMonthDay(stats.predictedNextStart) : '—',
        predictedNextStart: stats.predictedNextStart || '',
        avgCycleText: stats.avgCycleDays !== null ? `约 ${stats.avgCycleDays} 天` : '—',
        inProgressBadge:
          stats.inProgress && stats.daysSince !== null
            ? `进行中 · 第 ${stats.daysSince + 1} 天`
            : '',
        groups: groupByMonth(items),
        cycles,
      });
    } catch (e) {
      console.warn('[home] refresh failed', e);
      wx.showToast({ icon: 'none', title: '加载失败' });
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
      dayLabel: fmtMonthDay(e.occurred_at),
      timeLabel: fmtTime(e.occurred_at),
      text: formatMoodNote(e),
      canDelete: canSoftDelete(e.recorder_openid, me),
      dateKey: ymd(new Date(e.occurred_at)),
      selectKey: `note:${e._id}`,
    };
  },

  async onAddMoodNote() {
    const mood = await this.pickMood();
    if (!mood) return;
    const noteText = await this.inputMoodText(mood);
    if (!noteText) return;
    try {
      await api.createEvent({
        subject: 'wife',
        category: 'note',
        payload: { kind: 'mood', mood: mood.key, text: noteText },
        source: 'manual',
      });
      wx.showToast({ icon: 'success', title: '已记录心情' });
      if (this.data.activeTab !== 'note') {
        this.setData({ activeTab: 'note' });
      }
      this.refresh();
    } catch (e) {
      console.warn('[home] add mood note failed', e);
      wx.showToast({ icon: 'none', title: '记录失败' });
    }
  },

  async pickMood(): Promise<{ key: MoodKey; label: string; emoji: string } | null> {
    try {
      const res = await wx.showActionSheet({
        itemList: MOOD_OPTIONS.map(item => `${item.label} ${item.emoji}`),
      });
      return MOOD_OPTIONS[res.tapIndex] || null;
    } catch {
      return null;
    }
  },

  async inputMoodText(mood: { key: MoodKey; label: string; emoji: string }): Promise<string> {
    try {
      const res = await wx.showModal({
        title: `${mood.label}${mood.emoji} 说点什么`,
        editable: true,
        placeholderText: '比如：今天轻松一点了',
        confirmText: '保存',
        cancelText: '取消',
      });
      if (!res.confirm) return '';
      return (res.content || '').trim().slice(0, 200);
    } catch {
      return '';
    }
  },

  // ============ 主操作：今天来了 / 这次结束了 ============

  async onMarkPeriodStart() {
    const { user } = this.data;
    if (!user) return;
    wx.vibrateShort({ type: 'light' });

    try {
      const result = await api.createEvent({
        subject: 'wife',
        category: 'period_start',
        payload: { is_estimated: false, expected_end_offset_days: 5 },
      });
      if (result.deduped) {
        wx.showToast({ icon: 'none', title: '今天已经记过啦' });
      } else {
        this.showUndoToast(result.event._id, '已记录「今天来了」');
      }
      this.refresh();
    } catch (e) {
      console.warn('[home] mark period_start failed', e);
      wx.showToast({ icon: 'none', title: '记录失败' });
    }
  },

  async onMarkPeriodEnd() {
    const { user, stats } = this.data;
    if (!user) return;
    // 拦截：必须先有「今天来了」（且尚未结束）才能记结束
    if (!stats || !stats.inProgress) {
      wx.showToast({ icon: 'none', title: '请先记录开始时间', duration: 1800 });
      return;
    }
    wx.vibrateShort({ type: 'light' });
    try {
      const result = await api.createEvent({
        subject: 'wife',
        category: 'period_end',
        payload: { is_estimated: false },
      });
      if (result.deduped) {
        wx.showToast({ icon: 'none', title: '今天已经记过啦' });
      } else {
        this.showUndoToast(result.event._id, '已记录「这次结束了」');
      }
      this.refresh();
    } catch (e) {
      console.warn('[home] mark period_end failed', e);
      wx.showToast({ icon: 'none', title: '记录失败' });
    }
  },

  showUndoToast(eventId: string, msg: string) {
    this.setData({ pendingUndoEventId: eventId, showUndo: true });
    wx.showToast({ icon: 'success', title: msg, duration: 1500 });
    setTimeout(() => {
      if (this.data.pendingUndoEventId === eventId) {
        this.setData({ pendingUndoEventId: '', showUndo: false });
      }
    }, 5000);
  },

  async onUndo() {
    const id = this.data.pendingUndoEventId;
    if (!id) return;
    try {
      await api.hardDeleteEvent(id);
      wx.showToast({ icon: 'success', title: '已撤销' });
    } catch (e) {
      console.warn('[home] undo failed', e);
      wx.showToast({ icon: 'none', title: '撤销失败' });
    } finally {
      this.setData({ pendingUndoEventId: '', showUndo: false });
      this.refresh();
    }
  },

  // ============ 日历点选 → ActionSheet ============

  async onCalendarTap(e: WechatMiniprogram.CustomEvent<{ date?: string }>) {
    const date = e.detail && e.detail.date;
    if (!date) return;
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
      console.warn('[home] submitMark failed', e);
      wx.showToast({ icon: 'none', title: '记录失败' });
    }
  },

  // ============ Tabs / Cycle / 长按删除 ============

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
      console.warn('[home] set end failed', err);
      wx.showToast({ icon: 'none', title: '记录失败' });
    }
  },

  async onLongPressItem(e: WechatMiniprogram.TouchEvent) {
    if (!this.data.batchMode) return;
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

  async onLongPressCycleRecord(e: WechatMiniprogram.TouchEvent) {
    if (!this.data.batchMode) return;
    const dataset = e.currentTarget.dataset as { ids?: string };
    const ids = String(dataset.ids || '')
      .split(',')
      .map(id => id.trim())
      .filter(Boolean);
    if (ids.length === 0) return;

    const confirm = await wx.showModal({
      title: '确认删除？',
      content: `这条记录会删除 ${ids.length} 项内容`,
      confirmText: '删除',
      cancelText: '取消',
    });
    if (!confirm.confirm) return;

    let okCount = 0;
    for (const id of ids) {
      try {
        await api.hardDeleteEvent(id);
        okCount += 1;
      } catch (e) {
        console.warn('[home] delete cycle record failed', id, e);
      }
    }

    if (okCount > 0) {
      wx.showToast({
        icon: okCount === ids.length ? 'success' : 'none',
        title: okCount === ids.length ? '已删除' : `已删 ${okCount}/${ids.length}`,
      });
      this.refresh();
    } else {
      wx.showToast({ icon: 'none', title: '删除失败' });
    }
  },

  async onLongPressCycleCard(e: WechatMiniprogram.TouchEvent) {
    if (!this.data.batchMode) return;
    const dataset = e.currentTarget.dataset as { ids?: string };
    const ids = String(dataset.ids || '')
      .split(',')
      .map(id => id.trim())
      .filter(Boolean);
    if (ids.length === 0) {
      wx.showToast({ icon: 'none', title: '这张卡片暂时没有可删除内容' });
      return;
    }

    const confirm = await wx.showModal({
      title: '确认删除？',
      content: `会删除这次记录里的 ${ids.length} 项内容`,
      confirmText: '删除',
      cancelText: '取消',
    });
    if (!confirm.confirm) return;

    let okCount = 0;
    for (const id of ids) {
      try {
        await api.hardDeleteEvent(id);
        okCount += 1;
      } catch (e) {
        console.warn('[home] delete cycle card failed', id, e);
      }
    }

    if (okCount > 0) {
      wx.showToast({
        icon: okCount === ids.length ? 'success' : 'none',
        title: okCount === ids.length ? '已删除' : `已删 ${okCount}/${ids.length}`,
      });
      this.refresh();
    } else {
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

// ============ helpers（搬自 period.ts） ============

function groupByMonth(items: ListItemVM[]): GroupVM[] {
  const groups: GroupVM[] = [];
  for (const it of items) {
    const monthKey = it.dateKey.slice(0, 7);
    const last = groups[groups.length - 1];
    if (last && last.dateKey === monthKey) {
      last.items.push(it);
    } else {
      groups.push({
        dateKey: monthKey,
        dateLabel: monthLabel(monthKey),
        items: [it],
      });
    }
  }
  return groups;
}

/**
 * 把 events 配对成 cycle：每个 period_start 找下一个 period_end（且必须在下一个 start 之前）。
 * 同时把这一周期窗口内的经期相关事件按一次记录聚合成 cycle.records。
 * 输出按"最新在前"倒序。
 */
function buildCycles(
  events: AppEvent[],
  expandedMap: Record<string, boolean>,
): CycleVM[] {
  const valid = events.filter(e => !e.deleted_at && e.subject === 'wife' && !!e.occurred_at && !!e._id);
  const startsAsc = valid
    .filter(e => e.category === 'period_start')
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  const endsAsc = valid
    .filter(e => e.category === 'period_end')
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  const cycleEvents = valid.filter(e =>
    e.category === 'period_start' ||
    e.category === 'period_end' ||
    e.category === 'symptom' ||
    e.category === 'flow' ||
    isPeriodNoteEvent(e),
  );

  const usedEnds = new Set<string>();
  const cycles: CycleVM[] = [];

  for (let i = 0; i < startsAsc.length; i++) {
    const start = startsAsc[i];
    const next = startsAsc[i + 1];
    const startTs = new Date(start.occurred_at).getTime();
    const nextTs = next ? new Date(next.occurred_at).getTime() : Infinity;

    const matchedEnd = endsAsc.find(e => {
      if (usedEnds.has(e._id)) return false;
      const ts = new Date(e.occurred_at).getTime();
      return ts >= startTs && ts < nextTs;
    });
    if (matchedEnd) usedEnds.add(matchedEnd._id);

    const ongoing = !matchedEnd && !next;
    const windowEndTs = matchedEnd
      ? new Date(matchedEnd.occurred_at).getTime() + 86400000
      : (next ? nextTs : Date.now());

    const cycleEventsInWindow = cycleEvents.filter(e => {
      const ts = new Date(e.occurred_at).getTime();
      return ts >= startTs && ts <= windowEndTs;
    });

    const records = buildCycleRecords(
      cycleEventsInWindow,
    );

    let durationLabel: string;
    if (matchedEnd) {
      const days = daysBetween(matchedEnd.occurred_at, start.occurred_at) + 1;
      durationLabel = `${days} 天`;
    } else if (ongoing) {
      const days = daysBetween(new Date(), start.occurred_at) + 1;
      durationLabel = `进行中 · 第 ${days} 天`;
    } else {
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
      records,
      recordEventIds: cycleEventsInWindow.map(event => event._id),
      recordEventIdsText: cycleEventsInWindow.map(event => event._id).join(','),
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

function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split('-');
  const year = parseInt(y, 10);
  const month = parseInt(m, 10);
  const thisYear = new Date().getFullYear();
  return year === thisYear ? `${month}月` : `${year}年${month}月`;
}

function isMoodNoteEvent(e: AppEvent): boolean {
  if (e.category !== 'note') return false;
  const payload = asRecord(e.payload);
  return payload.kind === 'mood' && !!payload.mood;
}

function isPeriodNoteEvent(e: AppEvent): boolean {
  if (e.category !== 'note') return false;
  const payload = asRecord(e.payload);
  return payload.kind !== 'mood';
}

function formatMoodNote(e: AppEvent): string {
  const payload = asRecord(e.payload) as { text?: string; mood?: MoodKey };
  const mood = MOOD_OPTIONS.find(item => item.key === payload.mood);
  const prefix = mood ? mood.emoji : '💭';
  return `${prefix} ${payload.text || ''}`.trim();
}

function buildCycleRecords(events: AppEvent[]): CycleRecordVM[] {
  const sorted = [...events].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  const map = new Map<string, AppEvent[]>();

  sorted.forEach(e => {
    const key = `${e.batch_id || e.occurred_at}__${e.occurred_at}`;
    const bucket = map.get(key);
    if (bucket) bucket.push(e);
    else map.set(key, [e]);
  });

  return Array.from(map.values()).map(group => {
    const sample = [...group].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))[0];
    const lines = summarizeCycleGroup(group);
    return {
      id: group.map(item => item._id).join('_'),
      dateLabel: dateGroupLabel(sample.occurred_at),
      timeLabel: fmtTime(sample.occurred_at),
      lines,
      eventIds: group.map(item => item._id),
      eventIdsText: group.map(item => item._id).join(','),
    };
  }).filter(record => record.lines.length > 0);
}

function summarizeCycleGroup(group: AppEvent[]): string[] {
  const parts: string[] = [];
  const symptoms: string[] = [];
  let flowLine = '';
  let noteLine = '';

  const sorted = [...group].sort((a, b) => {
    const order = categoryOrder(a.category) - categoryOrder(b.category);
    if (order !== 0) return order;
    return safeIso(a.created_at || a.occurred_at).localeCompare(safeIso(b.created_at || b.occurred_at));
  });

  for (const e of sorted) {
    if (e.category === 'period_start' || e.category === 'period_end') continue;
    if (e.category === 'flow') {
      const m: Record<string, string> = { light: '少', medium: '中', heavy: '多' };
      flowLine = `流量：${m[e.subtype || 'medium']}`;
      continue;
    }
    if (e.category === 'symptom') {
      const map: Record<string, string> = {
        cramp: '腹痛',
        headache: '头痛',
        fatigue: '疲倦',
        nausea: '恶心',
        low_back_pain: '腰酸',
      };
      const sev = Number(asRecord(e.payload).severity) || 0;
      symptoms.push(`${map[e.subtype || ''] || '不适'}${sev ? ` ${sev}/5` : ''}`);
      continue;
    }
    if (isPeriodNoteEvent(e)) {
      const text = String(asRecord(e.payload).text || '');
      if (text) noteLine = `备注：${text}`;
    }
  }

  if (symptoms.length > 0) {
    parts.push(`不适：${symptoms.join('、')}`);
  }
  if (flowLine) parts.push(flowLine);
  if (noteLine) parts.push(noteLine);
  return parts;
}

function categoryOrder(category: string): number {
  switch (category) {
    case 'period_start': return 1;
    case 'period_end': return 2;
    case 'flow': return 3;
    case 'symptom': return 4;
    case 'note': return 5;
    default: return 99;
  }
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' ? (value as Record<string, any>) : {};
}

function safeIso(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
