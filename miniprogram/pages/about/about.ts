import { api, isCloudReady } from '../../utils/api';
import type { UserInfo } from '../../types/event';

Page({
  data: {
    user: null as UserInfo | null,
    cloudReady: false,
    titleClickCount: 0,
    showHidden: false,
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
      const user = await api.whoami();
      this.setData({ user });
    } catch (e) {
      console.warn('[about] whoami failed', e);
    }
  },

  // 隐藏菜单：连点 7 下「我们」标题
  onTitleTap() {
    const next = this.data.titleClickCount + 1;
    this.setData({ titleClickCount: next });
    if (next >= 7) {
      this.setData({ showHidden: true });
      wx.showToast({ icon: 'success', title: '隐藏菜单已开启' });
    }
  },

  // 切换 mock 身份调试
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
