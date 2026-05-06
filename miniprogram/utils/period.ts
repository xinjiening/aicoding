// 经期状态机算法 + 预测公式
// 严格遵循 design doc M1：显式处理 4 种 case，避免下游 NaN/undefined

import type { AppEvent, PeriodStats } from '../types/event';
import {
  AVG_CYCLE_FALLBACK_DAYS,
  AVG_CYCLE_MAX_DAYS,
  AVG_CYCLE_MIN_DAYS,
} from '../constants';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export function daysBetween(later: string | Date, earlier: string | Date): number {
  const l = typeof later === 'string' ? new Date(later) : later;
  const e = typeof earlier === 'string' ? new Date(earlier) : earlier;
  return Math.floor((l.getTime() - e.getTime()) / ONE_DAY_MS);
}

function median(nums: number[]): number {
  if (nums.length === 0) return NaN;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * M1：显式 4 case，全部带 null 兜底
 * - case 0：0 个 period_start  → 全 null
 * - case 1：1 个                → 只有 lastStart / daysSince / lastDuration
 * - case 2：2 个                → +avgCycle +predictedNext
 * - case ≥3：用最近 6 次的中位数 周期，过滤异常长周期
 */
export function calculatePeriodStats(events: AppEvent[]): PeriodStats {
  const valid = events.filter(e => !e.deleted_at);

  const periodStarts = valid
    .filter(e => e.category === 'period_start')
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  const periodEnds = valid
    .filter(e => e.category === 'period_end')
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));

  if (periodStarts.length === 0) {
    return {
      lastStart: null,
      daysSince: null,
      avgCycleDays: null,
      predictedNextStart: null,
      lastDurationDays: null,
      inProgress: false,
      totalCycles: 0,
    };
  }

  const lastStart = periodStarts[0].occurred_at;
  const daysSince = daysBetween(new Date(), lastStart);

  const lastEndEvent = periodEnds.find(
    end => new Date(end.occurred_at).getTime() > new Date(lastStart).getTime(),
  );
  const lastEnd = lastEndEvent ? lastEndEvent.occurred_at : null;
  const inProgress = !lastEnd;
  const lastDurationDays = lastEnd ? Math.max(1, daysBetween(lastEnd, lastStart) + 1) : null;

  if (periodStarts.length === 1) {
    return {
      lastStart,
      daysSince,
      avgCycleDays: null,
      predictedNextStart: null,
      lastDurationDays,
      inProgress,
      totalCycles: 1,
    };
  }

  // 2+ 个起点，算周期间隔（升序拿）
  const ascStarts = [...periodStarts].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  const intervals: number[] = [];
  for (let i = 1; i < ascStarts.length; i++) {
    const gap = daysBetween(ascStarts[i].occurred_at, ascStarts[i - 1].occurred_at);
    if (gap >= AVG_CYCLE_MIN_DAYS && gap <= AVG_CYCLE_MAX_DAYS) {
      intervals.push(gap);
    }
  }

  // 全部异常 → 退回 fallback（28 天），但仍标记预测低置信
  let avgCycleDays: number;
  if (intervals.length === 0) {
    avgCycleDays = AVG_CYCLE_FALLBACK_DAYS;
  } else if (intervals.length <= 2) {
    avgCycleDays = Math.round(intervals.reduce((s, n) => s + n, 0) / intervals.length);
  } else {
    avgCycleDays = Math.round(median(intervals.slice(-6)));
  }

  const predictedNextStart = new Date(
    new Date(lastStart).getTime() + avgCycleDays * ONE_DAY_MS,
  ).toISOString();

  return {
    lastStart,
    daysSince,
    avgCycleDays,
    predictedNextStart,
    lastDurationDays,
    inProgress,
    totalCycles: periodStarts.length,
  };
}

export function daysUntilPredicted(predicted: string | null): number | null {
  if (!predicted) return null;
  return daysBetween(predicted, new Date());
}

/** UI 文案：距离下次大姨妈的友好描述 */
export function describeNext(stats: PeriodStats): string {
  if (!stats.predictedNextStart) {
    if (stats.totalCycles === 0) return '点「今天来了」开始';
    if (stats.totalCycles === 1) return '再补录至少 1 次历史';
    return '—';
  }
  const d = daysUntilPredicted(stats.predictedNextStart);
  if (d === null) return '—';
  if (d > 1) return `大约 ${d} 天后`;
  if (d === 1) return '明天可能就来';
  if (d === 0) return '今天就在窗口里';
  if (d >= -3) return `已经过预测 ${-d} 天`;
  return `已超期 ${-d} 天`;
}
