// V1 全局常量
export const CLOUD_ENV = 'nxj-https://tcb.cloud.tencent.com/dev';
// ⬆️ 用户开通云开发后改成实际 envId（小程序后台 → 云开发 → 设置 → 环境ID）

export const DEFAULT_FAMILY_ID = 'default';

// V1 不再使用滑动窗口去重；改为按 occurred_at 的"自然日"去重，详见 cloudfunctions/data-rw 与 utils/api.ts。
// 保留这个常量以兼容历史代码（已无引用）。
export const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;

export const AI_DAILY_QUOTA = 30;

export const PING_INTERVAL_MS = 5 * 60 * 1000;

export const AVG_CYCLE_FALLBACK_DAYS = 28;
export const AVG_CYCLE_MIN_DAYS = 18;
export const AVG_CYCLE_MAX_DAYS = 60;

export const SYMPTOM_TAGS: Array<{ key: string; label: string; emoji: string }> = [
  { key: 'cramp', label: '腹痛', emoji: '🤕' },
  { key: 'headache', label: '头痛', emoji: '🤯' },
  { key: 'fatigue', label: '疲倦', emoji: '😪' },
  { key: 'nausea', label: '恶心', emoji: '🤢' },
  { key: 'low_back_pain', label: '腰酸', emoji: '😖' },
];

export const FLOW_LEVELS: Array<{ key: string; label: string }> = [
  { key: 'light', label: '少' },
  { key: 'medium', label: '中' },
  { key: 'heavy', label: '多' },
];

export const SEVERITY_LABELS = ['', '轻微', '一般', '明显', '难受', '强烈'];

export const WIDGETS_V1 = ['period'];
