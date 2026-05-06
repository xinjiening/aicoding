import { api } from '../../utils/api';
import { describeNext, daysUntilPredicted } from '../../utils/period';
import { dateGroupLabel, fmtMonthDay, fmtTime, ymd } from '../../utils/format';
import { recorderLabel, canSoftDelete, nextLine } from '../../utils/auth';
import type { AppEvent, HomeBundle, PeriodStats, UserInfo } from '../../types/event';

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

Page({
  data: {
    loading: true,
    isMock: false,
    user: null as UserInfo | null,
    stats: null as PeriodStats | null,
    nextLineLabel: '老婆下次大姨妈',
    nextDescribe: '点「今天来了」开始',
    daysToNext: null as number | null,
    lastDateText: '—',
    lastSinceText: '',
    predictedNextText: '—',
    avgCycleText: '—',
    inProgressBadge: '',
    recentGroups: [] as GroupVM[],
    pendingUndoEventId: '',
    showUndo: false,
  },

  onLoad() {
    this.refresh();
  },

  onShow() {
    this.refresh();
  },

  async refresh() {
    this.setData({ loading: true, isMock: api.isMock() });
    try {
      const bundle: HomeBundle = await api.loadHomeBundle();
      this.applyBundle(bundle);
    } catch (e) {
      console.warn('[home] refresh failed', e);
      wx.showToast({ icon: 'none', title: '加载失败' });
    } finally {
      this.setData({ loading: false });
    }
  },

  applyBundle(bundle: HomeBundle) {
    const { user, events, stats } = bundle;
    const items: ListItemVM[] = events
      .slice(0, 6)
      .map(e => this.toItemVM(e, user));

    this.setData({
      user,
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
      avgCycleText: stats.avgCycleDays !== null ? `约 ${stats.avgCycleDays} 天` : '—',
      inProgressBadge: stats.inProgress && stats.daysSince !== null ? `进行中 · 第 ${stats.daysSince + 1} 天` : '',
      recentGroups: groupByDate(items),
    });
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

  // 主操作：今天来了 — period_start
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
    const { user } = this.data;
    if (!user) return;
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

  goRecord() {
    wx.switchTab({ url: '/pages/record/record' });
  },
  goPeriod() {
    wx.switchTab({ url: '/pages/period/period' });
  },
});

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

function describeEvent(e: AppEvent): string {
  switch (e.category) {
    case 'period_start':
      return '记录：今天来了';
    case 'period_end':
      return '记录：这次结束了';
    case 'symptom': {
      const map: Record<string, string> = {
        cramp: '腹痛',
        headache: '头痛',
        fatigue: '疲倦',
        nausea: '恶心',
        low_back_pain: '腰酸',
      };
      const sev = (e.payload as { severity?: number }).severity;
      const label = map[e.subtype || ''] || '不适';
      return `${label}${sev ? ` · ${sev}/5` : ''}`;
    }
    case 'flow': {
      const flowMap: Record<string, string> = { light: '少', medium: '中', heavy: '多' };
      return `流量：${flowMap[e.subtype || 'medium']}`;
    }
    case 'note':
      return (e.payload as { text?: string }).text || '备注';
    default:
      return '记录';
  }
}
