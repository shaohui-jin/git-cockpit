/** 工作台卡片热力：近 12 周、按日一格（周一为一周起点）。 */

export const ACTIVITY_WEEKS = 12;
export const ACTIVITY_DAYS = ACTIVITY_WEEKS * 7;

export function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 当前周周一往前再数 11 周，得到 12 周窗口的第一天（本地日历）。 */
export function activityWindowStart(now = new Date()): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dow = d.getDay();
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + mondayOffset - (ACTIVITY_WEEKS - 1) * 7);
  return d;
}

export function emptyActivity(now = new Date()): {
  activityStart: string;
  activity: number[];
  activityTotal: number;
} {
  return {
    activityStart: ymd(activityWindowStart(now)),
    activity: new Array<number>(ACTIVITY_DAYS).fill(0),
    activityTotal: 0
  };
}

/** 把 `git log --date=short` 的 YYYY-MM-DD 收成 84 个日计数（旧→新）。 */
export function bucketActivityDays(
  dateStrs: string[],
  now = new Date()
): { activityStart: string; activity: number[]; activityTotal: number } {
  const start = activityWindowStart(now);
  const index = new Map<string, number>();
  const activity = new Array<number>(ACTIVITY_DAYS).fill(0);
  for (let i = 0; i < ACTIVITY_DAYS; i++) {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    index.set(ymd(day), i);
  }
  let activityTotal = 0;
  for (const raw of dateStrs) {
    const s = raw.trim();
    const i = index.get(s);
    if (i === undefined) continue;
    activity[i] = (activity[i] ?? 0) + 1;
    activityTotal += 1;
  }
  return { activityStart: ymd(start), activity, activityTotal };
}
