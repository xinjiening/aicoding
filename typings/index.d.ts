/// <reference path="./types/index.d.ts" />

interface IAppOption {
  globalData: {
    user?: import('../miniprogram/types/event').UserInfo;
    cloudReady: boolean;
    lastPingTs: number;
    pendingRecordDate?: string; // YYYY-MM-DD，日历点击 → 跳 record 携带的日期
  };
  ensureCloud(): Promise<import('../miniprogram/types/event').UserInfo | null>;
  pingIfStale(): Promise<void>;
  startPing(): void;

  // 满足 wx.getApp<T extends IAnyObject> 的索引签名约束
  [key: string]: any;
}
