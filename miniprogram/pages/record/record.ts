import { api } from '../../utils/api';
import { SYMPTOM_TAGS, FLOW_LEVELS, SEVERITY_LABELS } from '../../constants';
import { ymd } from '../../utils/format';
import type { UserInfo, EventCategory, EventSubtype, EventPayload } from '../../types/event';

const app = getApp<IAppOption>();

interface QueueItem {
  id: string;
  category: EventCategory;
  subtype?: EventSubtype;
  label: string;
  payload: EventPayload;
  occurredAt?: string;
  batchId?: string;
}

Page({
  data: {
    user: null as UserInfo | null,
    selectedSymptoms: {} as Record<string, number>, // subtype → severity 1-5
    selectedFlow: '' as string,
    noteText: '',
    timeMode: 'now' as 'now' | 'range',
    queue: [] as QueueItem[],
    submitting: false,
    symptomTags: SYMPTOM_TAGS,
    flowLevels: FLOW_LEVELS,
    severityLabels: SEVERITY_LABELS,
    todayDate: '',
    periodBatchId: '',
    periodStartDate: '',
    periodStartLabel: '',
    periodEndDate: '',
    periodEndLabel: '',
  },

  onLoad(opts: { date?: string }) {
    this.setData({ todayDate: ymd(new Date()) });
    if (app.globalData.pendingRecordDraft) {
      this.applyPendingDraft();
    } else if (opts.date) {
      this.applyRangeDate(opts.date);
    }
    this.loadUser();
  },

  onShow() {
    if (app.globalData.pendingRecordDraft) {
      this.applyPendingDraft();
      app.globalData.pendingRecordDate = undefined;
      return;
    }
    // 日历点击 → switchTab('record') 后通过 globalData 传递日期
    const pending = app.globalData.pendingRecordDate;
    if (pending) {
      this.applyRangeDate(pending);
      app.globalData.pendingRecordDate = undefined;
    }
  },

  applyRangeDate(date: string) {
    this.setData({
      timeMode: 'range',
      periodBatchId: '',
      periodStartDate: date,
      periodStartLabel: prettyDateLabel(date),
      periodEndDate: '',
      periodEndLabel: '',
    });
  },

  applyPendingDraft() {
    const draft = app.globalData.pendingRecordDraft;
    if (!draft) return;
    this.setData({
      timeMode: 'range',
      periodBatchId: draft.batchId || '',
      periodStartDate: draft.startDate || '',
      periodStartLabel: draft.startDate ? prettyDateLabel(draft.startDate) : '',
      periodEndDate: draft.endDate || '',
      periodEndLabel: draft.endDate ? prettyDateLabel(draft.endDate) : '',
    });
    app.globalData.pendingRecordDraft = undefined;
  },

  async loadUser() {
    try {
      const user = await api.whoami();
      this.setData({ user });
    } catch (e) {
      console.warn('[record] load user failed', e);
    }
  },

  onSymptomTap(e: WechatMiniprogram.TouchEvent) {
    const key = (e.currentTarget.dataset as { key: string }).key;
    const cur = { ...this.data.selectedSymptoms };
    if (cur[key]) {
      // 再点一下 → severity +1，到 5 后回 0（取消）
      const next = cur[key] + 1;
      if (next > 5) delete cur[key];
      else cur[key] = next;
    } else {
      cur[key] = 2; // 默认中等
    }
    this.setData({ selectedSymptoms: cur });
  },

  onFlowTap(e: WechatMiniprogram.TouchEvent) {
    const key = (e.currentTarget.dataset as { key: string }).key;
    this.setData({ selectedFlow: this.data.selectedFlow === key ? '' : key });
  },

  onNoteInput(e: WechatMiniprogram.Input) {
    this.setData({ noteText: (e.detail.value || '').slice(0, 500) });
  },

  onUseNow() {
    this.setData({
      timeMode: 'now',
      periodBatchId: '',
      periodStartDate: '',
      periodStartLabel: '',
      periodEndDate: '',
      periodEndLabel: '',
    });
  },

  onUseDateRange() {
    this.setData({ timeMode: 'range' });
  },

  onPeriodStartDateChange(e: WechatMiniprogram.PickerChange) {
    const periodStartDate = String(e.detail.value);
    const next: Record<string, string> = {
      periodStartDate,
      periodStartLabel: prettyDateLabel(periodStartDate),
    };
    // 若已选的结束早于新开始，则清掉结束
    if (this.data.periodEndDate && this.data.periodEndDate < periodStartDate) {
      next.periodEndDate = '';
      next.periodEndLabel = '';
    }
    this.setData(next as Partial<typeof this.data>);
  },

  onPeriodEndDateChange(e: WechatMiniprogram.PickerChange) {
    const periodEndDate = String(e.detail.value);
    if (this.data.periodStartDate && periodEndDate < this.data.periodStartDate) {
      wx.showToast({ icon: 'none', title: '结束不能早于开始' });
      return;
    }
    this.setData({
      periodEndDate,
      periodEndLabel: prettyDateLabel(periodEndDate),
    });
  },

  onClearPeriodStart() {
    // 清开始时，结束也跟着清掉（保持语义干净）
    this.setData({
      periodBatchId: '',
      periodStartDate: '',
      periodStartLabel: '',
      periodEndDate: '',
      periodEndLabel: '',
    });
  },

  onClearPeriodEnd() {
    this.setData({ periodEndDate: '', periodEndLabel: '' });
  },

  async onSubmit() {
    const items = this.buildQueue();
    if (items.length === 0) {
      wx.showToast({ icon: 'none', title: '至少记点症状/备注，或选大姨妈日期' });
      return;
    }
    const dateConflict = await this.findPeriodDateConflict();
    if (dateConflict.status === 'failed') {
      return;
    }
    if (dateConflict.status === 'blocked') {
      wx.showToast({ icon: 'none', title: '已在大姨妈期间' });
      return;
    }
    this.setData({ submitting: true });

    await this.cleanupConflictingRangeStarts();
    const sharedBatchId = this.data.periodBatchId || (this.shouldUseSharedBatch(items) ? makeBatchId() : '');

    let okCount = 0;
    let dedupedCount = 0;
    let hasPeriodEvent = false;
    for (const it of items) {
      try {
        const res = await api.createEvent({
          subject: 'wife',
          category: it.category,
          subtype: it.subtype,
          payload: it.payload,
          occurred_at: it.occurredAt || this.getDefaultOccurredAt(),
          source: 'manual',
          batch_id: it.batchId || sharedBatchId || undefined,
        });
        if (it.category === 'period_start' || it.category === 'period_end') {
          hasPeriodEvent = true;
        }
        if (res && res.deduped) dedupedCount += 1;
        okCount += 1;
      } catch (e) {
        console.warn('[record] save failed', it, e);
      }
    }

    this.setData({ submitting: false });

    if (okCount === items.length) {
      const tip = dedupedCount > 0 ? `已记 ${okCount} 条（${dedupedCount} 条已存在）` : `已记 ${okCount} 条`;
      wx.showToast({ icon: 'success', title: tip });
      this.resetForm();

      // 如果记了大姨妈周期事件，跳到周期页并落到「大姨妈」Tab，让用户立刻看到/操作
      if (hasPeriodEvent) {
        app.globalData.pendingPeriodTab = 'cycle';
      }
      setTimeout(() => {
        wx.switchTab({ url: '/pages/home/home' });
      }, 600);
    } else {
      wx.showToast({ icon: 'none', title: `只记成功 ${okCount}/${items.length}` });
    }
  },

  /**
   * 修复：当用户保存「开始<结束」的区间时，如果结束当天已经有一条 period_start，
   * 会把周期拆成「前一段未结束 + 当天单日周期」。这里在提交前做一次冲突清理。
   */
  async cleanupConflictingRangeStarts() {
    const { timeMode, periodStartDate, periodEndDate } = this.data;
    if (timeMode !== 'range') return;
    if (!periodStartDate || !periodEndDate) return;
    if (periodStartDate >= periodEndDate) return;

    try {
      const events = await api.listEvents({ subject: 'wife', limit: 300 });
      const boundaryStarts = events.filter(
        e =>
          e.category === 'period_start' &&
          !e.deleted_at &&
          ymd(new Date(e.occurred_at)) === periodEndDate,
      );
      if (boundaryStarts.length === 0) return;

      for (const ev of boundaryStarts) {
        try {
          await api.softDeleteEvent(ev._id);
        } catch (_e) {
          // 可能不是我本人记录，删除失败时忽略，不阻断主提交流程
        }
      }
    } catch (e) {
      console.warn('[record] cleanup conflicting starts failed', e);
    }
  },

  buildQueue(): QueueItem[] {
    const items: QueueItem[] = [];
    if (this.data.timeMode === 'range' && this.data.periodStartDate) {
      items.push({
        id: 'period_start',
        category: 'period_start',
        label: `start ${this.data.periodStartDate}`,
        payload: { is_estimated: false, expected_end_offset_days: 5 },
        occurredAt: toNoonIso(this.data.periodStartDate),
      });
    }
    if (this.data.timeMode === 'range' && this.data.periodEndDate) {
      items.push({
        id: 'period_end',
        category: 'period_end',
        label: `end ${this.data.periodEndDate}`,
        payload: { is_estimated: false },
        occurredAt: toNoonIso(this.data.periodEndDate),
      });
    }
    Object.keys(this.data.selectedSymptoms).forEach(k => {
      const sev = this.data.selectedSymptoms[k];
      items.push({
        id: 'sym_' + k,
        category: 'symptom',
        subtype: k as EventSubtype,
        label: `${k} · ${sev}/5`,
        payload: { severity: sev as 1 | 2 | 3 | 4 | 5 },
      });
    });
    if (this.data.selectedFlow) {
      items.push({
        id: 'flow',
        category: 'flow',
        subtype: this.data.selectedFlow as EventSubtype,
        label: `flow ${this.data.selectedFlow}`,
        payload: {},
      });
    }
    if (this.data.noteText.trim()) {
      items.push({
        id: 'note',
        category: 'note',
        label: this.data.noteText.trim().slice(0, 30),
        payload: { text: this.data.noteText.trim(), kind: 'period' },
      });
    }
    return items;
  },

  resetForm() {
    this.setData({
      selectedSymptoms: {},
      selectedFlow: '',
      noteText: '',
      timeMode: 'now',
      periodStartDate: '',
      periodStartLabel: '',
      periodEndDate: '',
      periodEndLabel: '',
      periodBatchId: '',
    });
  },

  getDefaultOccurredAt() {
    if (this.data.timeMode === 'range' && this.data.periodBatchId && this.data.periodEndDate) {
      return toNoonIso(this.data.periodEndDate);
    }
    if (this.data.timeMode === 'range' && this.data.periodStartDate) {
      return toNoonIso(this.data.periodStartDate);
    }
    return undefined;
  },

  shouldUseSharedBatch(items: QueueItem[]) {
    return items.some(it =>
      it.category === 'period_start' ||
      it.category === 'period_end' ||
      it.category === 'symptom' ||
      it.category === 'flow' ||
      it.category === 'note',
    );
  },

  async findPeriodDateConflict() {
    const dates = this.getBlockedValidationDates();
    if (dates.length === 0) {
      return { status: 'ok' as const };
    }
    if (this.data.periodBatchId) {
      return { status: 'ok' as const };
    }
    try {
      const events = await api.listEvents({ subject: 'wife', limit: 300 });
      const blockedDate = findClosedCycleConflictDate(events, dates);
      return blockedDate
        ? { status: 'blocked' as const, date: blockedDate }
        : { status: 'ok' as const };
    } catch (e) {
      console.warn('[record] validate period date failed', e);
      wx.showToast({ icon: 'none', title: '校验失败，请重试' });
      return { status: 'failed' as const };
    }
  },

  getBlockedValidationDates() {
    const dates: string[] = [];
    if (this.data.timeMode === 'range' && this.data.periodStartDate) {
      dates.push(this.data.periodStartDate);
    } else if (this.data.timeMode === 'now') {
      dates.push(ymd(new Date()));
    }
    if (this.data.timeMode === 'range' && this.data.periodEndDate) {
      dates.push(this.data.periodEndDate);
    }
    return dates;
  },
});

function toNoonIso(dateStr: string): string {
  const d = new Date(dateStr);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}

function makeBatchId(): string {
  return `batch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function findClosedCycleConflictDate(events: Array<{ _id: string; subject: 'wife' | 'husband'; category: string; occurred_at: string; deleted_at?: string }>, dates: string[]): string {
  const ranges = buildBlockedCycleRanges(events);
  for (const date of dates) {
    if (ranges.some(range => date >= range.startDate && date <= range.endDate)) {
      return date;
    }
  }
  return '';
}

function buildBlockedCycleRanges(events: Array<{ _id: string; subject: 'wife' | 'husband'; category: string; occurred_at: string; deleted_at?: string }>) {
  const valid = events.filter(e => !e.deleted_at && e.subject === 'wife' && !!e.occurred_at);
  const startsAsc = valid
    .filter(e => e.category === 'period_start')
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  const endsAsc = valid
    .filter(e => e.category === 'period_end')
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  const usedEnds = new Set<string>();
  const ranges: Array<{ startDate: string; endDate: string }> = [];

  for (let i = 0; i < startsAsc.length; i++) {
    const start = startsAsc[i];
    const nextStart = startsAsc[i + 1];
    const startTs = new Date(start.occurred_at).getTime();
    const nextStartTs = nextStart ? new Date(nextStart.occurred_at).getTime() : Infinity;
    const matchedEnd = endsAsc.find(end => {
      if (usedEnds.has(end._id)) return false;
      const endTs = new Date(end.occurred_at).getTime();
      return endTs >= startTs && endTs < nextStartTs;
    });
    if (matchedEnd) usedEnds.add(matchedEnd._id);
    ranges.push({
      startDate: ymd(new Date(start.occurred_at)),
      endDate: matchedEnd ? ymd(new Date(matchedEnd.occurred_at)) : '9999-12-31',
    });
  }

  return ranges;
}

/** YYYY-MM-DD → "5月3日" / 跨年时显示 "25年12月3日" */
function prettyDateLabel(ymdStr: string): string {
  if (!ymdStr) return '';
  const parts = ymdStr.split('-');
  if (parts.length !== 3) return ymdStr;
  const [y, m, d] = parts;
  const thisYear = new Date().getFullYear();
  if (parseInt(y, 10) === thisYear) {
    return `${parseInt(m, 10)}月${parseInt(d, 10)}日`;
  }
  return `${y.slice(2)}年${parseInt(m, 10)}月${parseInt(d, 10)}日`;
}
