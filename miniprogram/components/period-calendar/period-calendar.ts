// period-calendar：纯 wxml + ts，不依赖第三方 wxs
//
// 输入：
//  - periodEvents: AppEvent[]    完整 events，组件内自己识别 period_start/end/symptom
//  - predictedNextStart?: ISO    下一次预测开始日，用浅粉虚线标记
//  - month?: number              要显示的月份 (1-12)，默认当前
//  - year?: number               年，默认当前
//
// 输出：
//  - bind:tap  { date: 'YYYY-MM-DD' }

import type { AppEvent } from '../../types/event';

const DAY_MS = 86400000;

interface CellState {
  date: string;       // YYYY-MM-DD
  day: number;        // 1-31
  inMonth: boolean;
  isToday: boolean;
  isPeriod: boolean;
  hasSymptom: boolean;
  isPredicted: boolean;
}

function pad(n: number) { return n < 10 ? '0' + n : '' + n; }
function ymd(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

Component({
  properties: {
    periodEvents: { type: Array, value: [] as AppEvent[] },
    predictedNextStart: { type: String, value: '' },
    year: { type: Number, value: 0 },
    month: { type: Number, value: 0 },
  },
  data: {
    label: '',
    weeks: [] as CellState[][],
    canPrev: true,
    canNext: true,
    cursorYear: 0,
    cursorMonth: 0,
  },
  observers: {
    'periodEvents, predictedNextStart, year, month': function () {
      this.rebuild();
    },
  },
  lifetimes: {
    attached() {
      this.rebuild();
    },
  },
  methods: {
    rebuild() {
      const now = new Date();
      const y = (this.data.cursorYear || (this.properties as { year: number }).year) || now.getFullYear();
      const m = (this.data.cursorMonth || (this.properties as { month: number }).month) || now.getMonth() + 1;

      const first = new Date(y, m - 1, 1);
      const startOffset = first.getDay(); // 周日=0
      const startDate = new Date(first.getTime() - startOffset * DAY_MS);

      const periodDates = new Set<string>();
      const symptomDates = new Set<string>();
      const events = (this.properties as { periodEvents: AppEvent[] }).periodEvents || [];
      const inProgressMap = collectPeriodRanges(events);
      inProgressMap.forEach(d => periodDates.add(d));
      events.forEach(e => {
        if (e.deleted_at) return;
        if (e.category === 'symptom') symptomDates.add(ymd(new Date(e.occurred_at)));
      });

      const predictedKey = (this.properties as { predictedNextStart: string }).predictedNextStart
        ? ymd(new Date((this.properties as { predictedNextStart: string }).predictedNextStart))
        : '';

      const todayKey = ymd(now);
      const weeks: CellState[][] = [];
      let cursor = new Date(startDate);
      for (let w = 0; w < 6; w++) {
        const row: CellState[] = [];
        for (let d = 0; d < 7; d++) {
          const key = ymd(cursor);
          row.push({
            date: key,
            day: cursor.getDate(),
            inMonth: cursor.getMonth() + 1 === m,
            isToday: key === todayKey,
            isPeriod: periodDates.has(key),
            hasSymptom: symptomDates.has(key),
            isPredicted: predictedKey === key,
          });
          cursor = new Date(cursor.getTime() + DAY_MS);
        }
        weeks.push(row);
      }

      this.setData({
        weeks,
        cursorYear: y,
        cursorMonth: m,
        label: `${y}年${m}月`,
      });
    },
    onDayTap(e: WechatMiniprogram.TouchEvent) {
      const ds = (e.currentTarget && e.currentTarget.dataset) as { date?: string } | undefined;
      const date = ds && ds.date;
      if (!date) return; // Skyline 下首次/快速点击可能还没拿到 dataset
      this.triggerEvent('tap', { date });
    },
    prevMonth() {
      let { cursorYear: y, cursorMonth: m } = this.data;
      m -= 1;
      if (m < 1) { m = 12; y -= 1; }
      this.setData({ cursorYear: y, cursorMonth: m }, () => this.rebuild());
    },
    nextMonth() {
      let { cursorYear: y, cursorMonth: m } = this.data;
      m += 1;
      if (m > 12) { m = 1; y += 1; }
      this.setData({ cursorYear: y, cursorMonth: m }, () => this.rebuild());
    },
  },
});

/** 把 events 里的 period_start/period_end 配对，展开为「这次经期实际占用的所有日期」字符串集 */
function collectPeriodRanges(events: AppEvent[]): string[] {
  const valid = events.filter(e => !e.deleted_at);
  const starts = valid
    .filter(e => e.category === 'period_start')
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  const ends = valid
    .filter(e => e.category === 'period_end')
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));

  const dates: string[] = [];
  starts.forEach(s => {
    const sDate = new Date(s.occurred_at);
    const e = ends.find(x => new Date(x.occurred_at).getTime() >= sDate.getTime());
    const endDate = e ? new Date(e.occurred_at) : new Date(sDate.getTime() + 5 * DAY_MS);
    let cur = new Date(sDate);
    cur.setHours(0, 0, 0, 0);
    const stopAt = Math.min(endDate.getTime(), Date.now());
    while (cur.getTime() <= stopAt) {
      dates.push(ymd(cur));
      cur = new Date(cur.getTime() + DAY_MS);
    }
  });
  return dates;
}
