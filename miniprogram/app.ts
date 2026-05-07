import { CLOUD_ENV, PING_INTERVAL_MS } from './constants';
import { api, isCloudReady } from './utils/api';
import type { UserInfo } from './types/event';

interface IAppOption {
  globalData: {
    user?: UserInfo;
    cloudReady: boolean;
    lastPingTs: number;
    batchMode?: boolean;
    pendingRecordDate?: string;
    pendingRecordDraft?: {
      startDate?: string;
      endDate?: string;
      subject?: 'wife' | 'husband';
      batchId?: string;
    };
    pendingPeriodTab?: 'note' | 'cycle';
  };
  ensureCloud(): Promise<UserInfo | null>;
  pingIfStale(): Promise<void>;
  startPing(): void;
}

App<IAppOption>({
  globalData: {
    cloudReady: false,
    lastPingTs: 0,
    batchMode: false,
  },

  onLaunch() {
    if (isCloudReady() && wx.cloud) {
      try {
        wx.cloud.init({
          env: CLOUD_ENV,
          traceUser: true,
        });
        this.globalData.cloudReady = true;
      } catch (e) {
        console.warn('[app] cloud init failed', e);
      }
    } else {
      console.warn('[app] CLOUD_ENV 未配置，进入降级（mock）模式。开通云开发后请修改 miniprogram/constants.ts 中的 CLOUD_ENV。');
    }

    this.ensureCloud();
  },

  onShow() {
    this.startPing();
  },

  async ensureCloud(): Promise<UserInfo | null> {
    try {
      const user = await api.whoami();
      this.globalData.user = user;
      return user;
    } catch (e) {
      console.warn('[app] whoami failed', e);
      return null;
    }
  },

  async pingIfStale() {
    const now = Date.now();
    if (now - this.globalData.lastPingTs < 4 * 60 * 1000) return;
    this.globalData.lastPingTs = now;
    try {
      await api.ping();
    } catch (e) {
      // 静默失败
    }
  },

  startPing() {
    setInterval(() => {
      this.pingIfStale();
    }, PING_INTERVAL_MS);
  },
});
