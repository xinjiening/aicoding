import { api } from '../../utils/api';
import { SYMPTOM_TAGS, FLOW_LEVELS, SEVERITY_LABELS } from '../../constants';
import { fmtDateTime } from '../../utils/format';
import type { Subject, UserInfo, EventCategory, EventSubtype, EventPayload } from '../../types/event';

const app = getApp<IAppOption>();

interface QueueItem {
  id: string;
  category: EventCategory;
  subtype?: EventSubtype;
  label: string;
  payload: EventPayload;
}

Page({
  data: {
    user: null as UserInfo | null,
    subject: 'wife' as Subject,
    selectedSymptoms: {} as Record<string, number>, // subtype → severity 1-5
    selectedFlow: '' as string,
    noteText: '',
    occurredAt: '',
    occurredAtLabel: '现在',
    queue: [] as QueueItem[],
    submitting: false,
    symptomTags: SYMPTOM_TAGS,
    flowLevels: FLOW_LEVELS,
    severityLabels: SEVERITY_LABELS,
    inputDate: '',
  },

  onLoad(opts: { date?: string }) {
    if (opts.date) {
      this.applyDate(opts.date);
    } else {
      this.setData({ occurredAt: '', occurredAtLabel: '现在' });
    }
    this.loadUser();
  },

  onShow() {
    // 日历点击 → switchTab('record') 后通过 globalData 传递日期
    const pending = app.globalData.pendingRecordDate;
    if (pending) {
      this.applyDate(pending);
      app.globalData.pendingRecordDate = undefined;
    }
  },

  applyDate(date: string) {
    const d = new Date(date);
    d.setHours(12, 0, 0, 0);
    this.setData({
      occurredAt: d.toISOString(),
      occurredAtLabel: fmtDateTime(d),
      inputDate: date,
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

  onDateChange(e: WechatMiniprogram.PickerChange) {
    const dateStr = String(e.detail.value);
    const d = new Date(dateStr);
    d.setHours(12, 0, 0, 0);
    this.setData({
      occurredAt: d.toISOString(),
      occurredAtLabel: fmtDateTime(d),
      inputDate: dateStr,
    });
  },

  onUseNow() {
    this.setData({ occurredAt: '', occurredAtLabel: '现在', inputDate: '' });
  },

  async onSubmit() {
    const items = this.buildQueue();
    if (items.length === 0) {
      wx.showToast({ icon: 'none', title: '至少选一个标签或写点字' });
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
          occurred_at: this.data.occurredAt || undefined,
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
      occurredAt: '',
      occurredAtLabel: '现在',
      inputDate: '',
    });
  },
});
