// 统一云函数代理 + 降级（mock）层
// V1：CLOUD_ENV 未配置时进入 mock 模式，让 UI 在开发者工具中可预览

import { CLOUD_ENV, DEFAULT_FAMILY_ID } from '../constants';
import type {
  AppEvent,
  CloudResponse,
  EventCategory,
  EventPayload,
  EventSubtype,
  HomeBundle,
  PeriodStats,
  Subject,
  UserInfo,
} from '../types/event';

const MOCK_PREFIX = 'mock_db_';
const MOCK_USER_KEY = 'mock_user';

// ---------- Cloud env 判断 ----------

export function isCloudReady(): boolean {
  return !!CLOUD_ENV && !CLOUD_ENV.startsWith('TODO_');
}

// ---------- 单飞缓存（防 1s 内同名同参重复调用）----------

const inflight = new Map<string, { ts: number; promise: Promise<unknown> }>();

function cacheKey(name: string, payload: unknown): string {
  return `${name}::${JSON.stringify(payload === undefined ? null : payload)}`;
}

function callWithDedup<T>(name: string, payload: unknown, fn: () => Promise<T>): Promise<T> {
  const key = cacheKey(name, payload);
  const now = Date.now();
  const cached = inflight.get(key);
  if (cached && now - cached.ts < 1000) {
    return cached.promise as Promise<T>;
  }
  const promise = fn().finally(() => {
    setTimeout(() => inflight.delete(key), 1000);
  });
  inflight.set(key, { ts: now, promise });
  return promise;
}

// ---------- 真云函数调用 ----------

async function callCloud<T>(name: string, data: Record<string, unknown> = {}): Promise<T> {
  if (!wx.cloud) throw new Error('cloud_sdk_unavailable');
  const res = await wx.cloud.callFunction({ name, data });
  const body = res.result as CloudResponse<T>;
  if (!body || !body.ok) {
    throw new Error((body && body.error) || 'cloud_call_failed');
  }
  return body.data as T;
}

// ---------- Mock 层（云开发未开通时使用）----------

function mockUser(): UserInfo {
  let cached = wx.getStorageSync(MOCK_USER_KEY) as UserInfo | '';
  if (!cached) {
    cached = {
      openid: 'mock_openid_husband',
      family_id: DEFAULT_FAMILY_ID,
      role: 'husband',
    };
    wx.setStorageSync(MOCK_USER_KEY, cached);
  }
  return cached as UserInfo;
}

function mockEvents(): AppEvent[] {
  const arr = (wx.getStorageSync(`${MOCK_PREFIX}events`) || []) as AppEvent[];
  return arr;
}

function saveMockEvents(events: AppEvent[]) {
  wx.setStorageSync(`${MOCK_PREFIX}events`, events);
}

function mockId(): string {
  return 'm_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function mockListEvents(family_id: string, subject?: Subject): AppEvent[] {
  return mockEvents()
    .filter(e => e.family_id === family_id && !e.deleted_at && (!subject || e.subject === subject))
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
}

import { calculatePeriodStats } from './period';

function mockHomeBundle(): HomeBundle {
  const user = mockUser();
  const events = mockListEvents(user.family_id, 'wife');
  const stats = calculatePeriodStats(events);
  return { user, events, stats };
}

function mockCreateEvent(input: CreateEventInput): { event: AppEvent; deduped: boolean; existing_id?: string } {
  const user = mockUser();
  const now = new Date().toISOString();
  const occurred_at = input.occurred_at || now;
  const family_id = user.family_id;

  // 同一自然日去重锁（仅 period_start / period_end）
  if (input.category === 'period_start' || input.category === 'period_end') {
    const occ = new Date(occurred_at);
    const dayStart = new Date(occ.getFullYear(), occ.getMonth(), occ.getDate()).getTime();
    const dayEnd = dayStart + 24 * 60 * 60 * 1000;
    const dup = mockEvents().find(
      e =>
        e.family_id === family_id &&
        e.subject === input.subject &&
        e.category === input.category &&
        !e.deleted_at &&
        new Date(e.occurred_at).getTime() >= dayStart &&
        new Date(e.occurred_at).getTime() < dayEnd,
    );
    if (dup) {
      return { event: dup, deduped: true, existing_id: dup._id };
    }
  }

  const event: AppEvent = {
    _id: mockId(),
    family_id,
    recorder_openid: user.openid,
    subject: input.subject,
    category: input.category,
    subtype: input.subtype,
    occurred_at,
    payload: input.payload,
    source: input.source || 'manual',
    batch_id: input.batch_id,
    created_at: now,
  };

  const all = mockEvents();
  all.unshift(event);
  saveMockEvents(all);
  return { event, deduped: false };
}

function mockSoftDelete(event_id: string): boolean {
  const all = mockEvents();
  const idx = all.findIndex(e => e._id === event_id);
  if (idx < 0) return false;
  const target = all[idx];
  const user = mockUser();
  if (target.recorder_openid !== user.openid) {
    throw new Error('only_owner_can_delete');
  }
  all[idx] = { ...target, deleted_at: new Date().toISOString() };
  saveMockEvents(all);
  return true;
}

function mockHardDelete(event_id: string): boolean {
  const all = mockEvents();
  const next = all.filter(e => e._id !== event_id);
  saveMockEvents(next);
  return true;
}

// ---------- 对外 API ----------

export interface CreateEventInput {
  subject: Subject;
  category: EventCategory;
  subtype?: EventSubtype;
  occurred_at?: string;
  payload: EventPayload;
  source?: 'manual' | 'ai';
  batch_id?: string;
}

export const api = {
  isMock: () => !isCloudReady(),

  whoami(): Promise<UserInfo> {
    return callWithDedup('whoami', {}, async () => {
      if (!isCloudReady()) return mockUser();
      return callCloud<UserInfo>('whoami');
    });
  },

  ping(): Promise<{ ok: true; ts: number }> {
    return callWithDedup('ping', {}, async () => {
      if (!isCloudReady()) return { ok: true, ts: Date.now() };
      return callCloud('ping');
    });
  },

  loadHomeBundle(): Promise<HomeBundle> {
    return callWithDedup('home-bundle', {}, async () => {
      if (!isCloudReady()) return mockHomeBundle();
      return callCloud<HomeBundle>('home-bundle');
    });
  },

  listEvents(args: { subject?: Subject; limit?: number } = {}): Promise<AppEvent[]> {
    return callWithDedup('list-events', args, async () => {
      if (!isCloudReady()) {
        const user = mockUser();
        const limit = typeof args.limit === 'number' ? args.limit : 200;
        return mockListEvents(user.family_id, args.subject).slice(0, limit);
      }
      return callCloud<AppEvent[]>('data-rw', { action: 'listEvents', ...args });
    });
  },

  createEvent(input: CreateEventInput): Promise<{ event: AppEvent; deduped: boolean; existing_id?: string }> {
    if (!isCloudReady()) {
      return Promise.resolve(mockCreateEvent(input));
    }
    return callCloud('data-rw', { action: 'createEvent', input });
  },

  softDeleteEvent(event_id: string): Promise<boolean> {
    if (!isCloudReady()) return Promise.resolve(mockSoftDelete(event_id));
    return callCloud<boolean>('data-rw', { action: 'softDeleteEvent', event_id });
  },

  hardDeleteEvent(event_id: string): Promise<boolean> {
    if (!isCloudReady()) return Promise.resolve(mockHardDelete(event_id));
    return callCloud<boolean>('data-rw', { action: 'hardDeleteEvent', event_id });
  },

  // mock 模式专属：切换为妻子身份调试
  switchMockRole(role: 'husband' | 'wife') {
    if (isCloudReady()) return;
    const user: UserInfo = {
      openid: role === 'husband' ? 'mock_openid_husband' : 'mock_openid_wife',
      family_id: DEFAULT_FAMILY_ID,
      role,
    };
    wx.setStorageSync(MOCK_USER_KEY, user);
  },

  resetMockData() {
    wx.removeStorageSync(`${MOCK_PREFIX}events`);
  },

  // 提供给页面：获取 stats（mock 直接算，cloud 时复用 home-bundle.stats）
  computeStats(events: AppEvent[]): PeriodStats {
    return calculatePeriodStats(events);
  },
};
