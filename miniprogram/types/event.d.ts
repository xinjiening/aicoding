// 共享类型定义 — 前端 + 云函数都 import 这份
// 改动这里时记得 cloudfunctions/*/event.d.ts 同步（V1 阶段手动）

export type EventCategory =
  | 'period_start'
  | 'period_end'
  | 'symptom'
  | 'flow'
  | 'note';

export type SymptomSubtype =
  | 'cramp'
  | 'headache'
  | 'fatigue'
  | 'nausea'
  | 'low_back_pain';

export type FlowSubtype = 'light' | 'medium' | 'heavy';

export type EventSubtype = SymptomSubtype | FlowSubtype;

export type EventSource = 'manual' | 'ai' | 'auto';

export type Subject = 'wife' | 'husband';

export interface PeriodStartPayload {
  expected_end_offset_days?: number;
  is_estimated: boolean;
  note?: string;
}

export interface PeriodEndPayload {
  is_estimated: boolean;
  note?: string;
}

export interface SymptomPayload {
  severity: 1 | 2 | 3 | 4 | 5;
  note?: string;
}

export interface FlowPayload {
  note?: string;
}

export interface NotePayload {
  text: string;
}

export type EventPayload =
  | PeriodStartPayload
  | PeriodEndPayload
  | SymptomPayload
  | FlowPayload
  | NotePayload;

export interface AppEvent {
  _id: string;
  family_id: string;
  recorder_openid: string;
  subject: Subject;
  category: EventCategory;
  subtype?: EventSubtype;
  occurred_at: string;
  payload: EventPayload;
  source: EventSource;
  batch_id?: string;
  deleted_at?: string;
  created_at: string;
}

export interface Family {
  _id: string;
  name: string;
  created_at: string;
  created_by: string;
  members: string[];
}

export type Role = 'husband' | 'wife' | 'unknown';

export interface UserInfo {
  openid: string;
  family_id: string;
  role: Role;
}

// period.ts 算法返回类型
export interface PeriodStats {
  lastStart: string | null;
  daysSince: number | null;
  avgCycleDays: number | null;
  predictedNextStart: string | null;
  lastDurationDays: number | null;
  inProgress: boolean;
  totalCycles: number;
}

// home-bundle 云函数返回类型
export interface HomeBundle {
  user: UserInfo;
  events: AppEvent[];
  stats: PeriodStats;
}

// 云函数统一响应壳
export interface CloudResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
  message?: string;
  deduped?: boolean;
  existing_id?: string;
}
