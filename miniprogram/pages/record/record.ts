import { api } from '../../utils/api';
import { SYMPTOM_TAGS, FLOW_LEVELS, SEVERITY_LABELS } from '../../constants';
import { ymd } from '../../utils/format';
import type { Subject, UserInfo, EventCategory, EventSubtype, EventPayload } from '../../types/event';

const app = getApp<IAppOption>();

interface QueueItem {
  id: string;
  category: EventCategory;
  subtype?: EventSubtype;
  label: string;
  payload: EventPayload;
  occurredAt?: string;
}

Page({
  data: {
    user: null as UserInfo | null,
    subject: 'wife' as Subject,
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
    periodStartDate: '',
    periodEndDate: '',
  },

  onLoad(opts: { date?: string }) {
    this.setData({ todayDate: ymd(new Date()) });
    if (opts.date) {
      this.applyRangeDate(opts.date);
    }
    this.loadUser();
  },

  onShow() {
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
      periodStartDate: date,
      periodEndDate: '',
    });
  },

  async loadUser() {
    try {
      const user = await api.whoami();
      this.setData({ user });
    } catch (e) {
      console.warn('[record] load user failed', e);
    }
  },

  onSubjectTap(e: WechatMiniprogram.TouchEvent) {
    const subject = (e.currentTarget.dataset as { subject: Subject }).subject;
    this.setData({ subject });
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
    this.setData({ timeMode: 'now', periodStartDate: '', periodEndDate: '' });
  },

  onUseDateRange() {
    this.setData({ timeMode: 'range' });
  },

  onPeriodStartDateChange(e: WechatMiniprogram.PickerChange) {
    const periodStartDate = String(e.detail.value);
    const nextData: Record<string, string> = { periodStartDate };
    if (this.data.periodEndDate && this.data.periodEndDate < periodStartDate) {
      nextData.periodEndDate = '';
    }
    this.setData(nextData as { periodStartDate: string; periodEndDate?: string });
  },

  onPeriodEndDateChange(e: WechatMiniprogram.PickerChange) {
    const periodEndDate = String(e.detail.value);
    if (!this.data.periodStartDate) {
      wx.showToast({ icon: 'none', title: '先选开始日期' });
      return;
    }
    if (periodEndDate < this.data.periodStartDate) {
      wx.showToast({ icon: 'none', title: '结束不能早于开始' });
      return;
    }
    this.setData({ periodEndDate });
  },

  onClearPeriodStart() {
    this.setData({ periodStartDate: '', periodEndDate: '' });
  },

  onClearPeriodEnd() {
    this.setData({ periodEndDate: '' });
  },

  async onSubmit() {
    const items = this.buildQueue();
    if (items.length === 0) {
      wx.showToast({ icon: 'none', title: '至少记点症状、备注，或选大姨妈日期' });
      return;
    }
    if (this.data.timeMode === 'range' && !this.data.periodStartDate) {
      wx.showToast({ icon: 'none', title: '先选开始日期' });
      return;
    }
    this.setData({ submitting: true });

    let okCount = 0;
    for (const it of items) {
      try {
        await api.createEvent({
          subject: this.data.subject,
          category: it.category,
          subtype: it.subtype,
          payload: it.payload,
          occurred_at: it.occurredAt || this.getDefaultOccurredAt(),
          source: 'manual',
        });
        okCount += 1;
      } catch (e) {
        console.warn('[record] save failed', it, e);
      }
    }

    this.setData({ submitting: false });
    if (okCount === items.length) {
      wx.showToast({ icon: 'success', title: `已记 ${okCount} 条` });
      this.resetForm();
      setTimeout(() => {
        wx.switchTab({ url: '/pages/period/period' });
      }, 600);
    } else {
      wx.showToast({ icon: 'none', title: `只记成功 ${okCount}/${items.length}` });
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
        payload: { text: this.data.noteText.trim() },
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
      periodEndDate: '',
    });
  },

  getDefaultOccurredAt() {
    if (this.data.timeMode === 'range' && this.data.periodStartDate) {
      return toNoonIso(this.data.periodStartDate);
    }
    return undefined;
  },
});

function toNoonIso(dateStr: string): string {
  const d = new Date(dateStr);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}
