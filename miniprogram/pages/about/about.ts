import { api, isCloudReady } from '../../utils/api';
import { calculatePeriodStats } from '../../utils/period';
import {
  AVG_CYCLE_MIN_DAYS,
  AVG_CYCLE_MAX_DAYS,
} from '../../constants';
import type { Role, UserInfo } from '../../types/event';

type MoodKey = 'happy' | 'neutral' | 'sad';

const MOOD_OPTIONS: Array<{ key: MoodKey; label: string; emoji: string }> = [
  { key: 'happy', label: '开心', emoji: '🙂' },
  { key: 'neutral', label: '一般', emoji: '😐' },
  { key: 'sad', label: '难过', emoji: '🙁' },
];

const app = getApp<IAppOption>();

Page({
  data: {
    user: null as UserInfo | null,
    cloudReady: false,
    titleClickCount: 0,
    showHidden: false,
    batchMode: false,

    // 周期长度卡片
    minCycle: AVG_CYCLE_MIN_DAYS,
    maxCycle: AVG_CYCLE_MAX_DAYS,
    autoAvgDays: null as number | null,
    autoAvgText: '—',
    effectiveAvgText: '—',
    manualInput: '',
  },

  onLoad() {
    this.refresh();
  },
  onShow() {
    this.refresh();
  },

  async refresh() {
    this.setData({ cloudReady: isCloudReady() });
    try {
      const [user, events] = await Promise.all([
        api.whoami(),
        api.listEvents({ subject: 'wife' }),
      ]);
      const auto = calculatePeriodStats(events);
      const effective = calculatePeriodStats(events, user.manual_avg_cycle_days);

      this.setData({
        user,
        batchMode: !!app.globalData.batchMode,
        autoAvgDays: auto.avgCycleDays,
        autoAvgText: auto.avgCycleDays !== null ? `约 ${auto.avgCycleDays} 天` : '数据不足',
        effectiveAvgText:
          effective.avgCycleDays !== null ? `约 ${effective.avgCycleDays} 天` : '—',
        manualInput:
          user.manual_avg_cycle_days != null ? String(user.manual_avg_cycle_days) : '',
      });
    } catch (e) {
      console.warn('[about] refresh failed', e);
    }
  },

  // ============ 角色切换 ============

  async onSelectRole(e: WechatMiniprogram.TouchEvent) {
    const role = (e.currentTarget.dataset as { role: Role }).role;
    if (role !== 'husband' && role !== 'wife') return;
    if (this.data.user && this.data.user.role === role && this.data.user.role_manually_set) {
      return;
    }
    try {
      await api.setRole(role);
      wx.showToast({ icon: 'success', title: role === 'husband' ? '已切换：丈夫' : '已切换：老婆' });
      this.refresh();
    } catch (err) {
      const msg = (err as Error).message || 'unknown';
      console.warn('[about] setRole failed', err);
      wx.showToast({ icon: 'none', title: `切换失败：${msg}`, duration: 2500 });
    }
  },

  // ============ 手动平均周期 ============

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
    } catch (e) {
      console.warn('[about] add mood note failed', e);
      wx.showToast({ icon: 'none', title: '记录失败' });
    }
  },

  onBatchModeChange(e: WechatMiniprogram.SwitchChange) {
    const batchMode = !!e.detail.value;
    app.globalData.batchMode = batchMode;
    this.setData({ batchMode });
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

  onManualInput(e: WechatMiniprogram.Input) {
    // 只保留数字，避免负号小数等
    const cleaned = String(e.detail.value || '').replace(/[^\d]/g, '').slice(0, 3);
    this.setData({ manualInput: cleaned });
  },

  async onSetManualAvgCycle() {
    const days = parseInt(this.data.manualInput, 10);
    if (
      !Number.isFinite(days) ||
      !Number.isInteger(days) ||
      days < AVG_CYCLE_MIN_DAYS ||
      days > AVG_CYCLE_MAX_DAYS
    ) {
      wx.showToast({
        icon: 'none',
        title: `请填 ${AVG_CYCLE_MIN_DAYS}-${AVG_CYCLE_MAX_DAYS} 之间的整数`,
      });
      return;
    }
    try {
      await api.setManualAvgCycle(days);
      wx.showToast({ icon: 'success', title: '已保存' });
      this.refresh();
    } catch (e) {
      const msg = (e as Error).message || 'unknown';
      console.warn('[about] setManualAvgCycle failed', e);
      wx.showToast({ icon: 'none', title: `保存失败：${msg}`, duration: 2500 });
    }
  },

  async onClearManualAvgCycle() {
    const ok = await wx.showModal({
      title: '清除手动设置？',
      content: '清除后将恢复使用「自动估算」的平均周期',
      confirmText: '清除',
      cancelText: '取消',
    });
    if (!ok.confirm) return;
    try {
      await api.clearManualAvgCycle();
      wx.showToast({ icon: 'success', title: '已清除' });
      this.refresh();
    } catch (e) {
      const msg = (e as Error).message || 'unknown';
      console.warn('[about] clearManualAvgCycle failed', e);
      wx.showToast({ icon: 'none', title: `清除失败：${msg}`, duration: 2500 });
    }
  },

  // ============ 旧的调试入口 ============

  // 隐藏菜单：连点 7 下「关于」标题
  onTitleTap() {
    const next = this.data.titleClickCount + 1;
    this.setData({ titleClickCount: next });
    if (next >= 7) {
      this.setData({ showHidden: true });
      wx.showToast({ icon: 'success', title: '隐藏菜单已开启' });
    }
  },

  // 切换 mock 身份调试（仅 Mock 模式生效）
  onSwitchToHusband() {
    api.switchMockRole('husband');
    wx.showToast({ icon: 'success', title: '已切换：丈夫' });
    this.refresh();
  },
  onSwitchToWife() {
    api.switchMockRole('wife');
    wx.showToast({ icon: 'success', title: '已切换：妻子' });
    this.refresh();
  },

  async onResetMock() {
    const ok = await wx.showModal({ title: '清空本地 mock 数据？', content: '不影响云端' });
    if (!ok.confirm) return;
    api.resetMockData();
    wx.showToast({ icon: 'success', title: '已清空' });
  },

  onExport() {
    wx.showModal({
      title: '导出',
      content: 'V1.2 再做。当前数据量小，可在云开发控制台 → 数据库 → events 集合 → 导出 JSON。',
      showCancel: false,
    });
  },

  onCopyEnv() {
    wx.setClipboardData({ data: 'miniprogram/constants.ts → CLOUD_ENV' });
  },
});
