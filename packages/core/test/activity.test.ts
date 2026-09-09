import { describe, expect, it } from 'vitest';
import { ACTIVITY_DAYS, activityWindowStart, bucketActivityDays, emptyActivity, ymd } from '../src/activity.ts';

describe('activity 热力分桶', () => {
  it('窗口从本周一往前共 12 周，长度 84', () => {
    const now = new Date(2026, 8, 9); // 周三
    const start = activityWindowStart(now);
    expect(start.getDay()).toBe(1);
    expect(ymd(start)).toBe('2026-06-22');
    const empty = emptyActivity(now);
    expect(empty.activity).toHaveLength(ACTIVITY_DAYS);
    expect(empty.activityTotal).toBe(0);
  });

  it('只统计窗口内的日期，按日累加', () => {
    const now = new Date(2026, 8, 9);
    const out = bucketActivityDays(['2026-06-22', '2026-06-22', '2026-09-09', '2025-01-01'], now);
    expect(out.activityStart).toBe('2026-06-22');
    expect(out.activity[0]).toBe(2);
    expect(out.activity[11 * 7 + 2]).toBe(1); // 本周三
    expect(out.activityTotal).toBe(3);
  });
});
