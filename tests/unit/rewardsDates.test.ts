import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module
import { localDateString, currentStreak } from '../../netlify/functions/services/rewards-dates.js';

describe('localDateString', () => {
  it('uses the programme timezone, not UTC', () => {
    // 23:30 UTC on 17 Nov is already 00:30 on 18 Nov in Lagos (UTC+1).
    const d = new Date('2026-11-17T23:30:00Z');
    expect(localDateString(d, 'Africa/Lagos')).toBe('2026-11-18');
    expect(localDateString(d, 'UTC')).toBe('2026-11-17');
  });
});

describe('currentStreak', () => {
  const reset = { reset_policy: 'reset', grace_days: 0 };
  const grace = { reset_policy: 'grace', grace_days: 2 };

  it('is 0 with no claims', () => {
    expect(currentStreak([], '2026-11-18', reset)).toBe(0);
  });
  it('continues if claimed today or yesterday', () => {
    expect(currentStreak([{ claim_date: '2026-11-18', streak_count: 4 }], '2026-11-18', reset)).toBe(4);
    expect(currentStreak([{ claim_date: '2026-11-17', streak_count: 4 }], '2026-11-18', reset)).toBe(4);
  });
  it('resets after a missed day unless grace allows it', () => {
    const c = [{ claim_date: '2026-11-15', streak_count: 6 }];
    expect(currentStreak(c, '2026-11-18', reset)).toBe(0);
    expect(currentStreak(c, '2026-11-18', grace)).toBe(6);
    expect(currentStreak(c, '2026-11-19', grace)).toBe(0);
  });
});
