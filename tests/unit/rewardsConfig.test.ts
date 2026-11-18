import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module
import { validatePolicy, referralTierFor } from '../../netlify/functions/services/rewards-config.js';

// Test fixture only. Real values live in rewards_config_versions (JLO admin).
const base = () => ({
  schema_version: 1,
  programme: { enabled: true, name: 'Points', launch_at: '2026-12-01T00:00:00Z', timezone: 'Africa/Lagos', points_to_ngn: 5 },
  signup: { enabled: true, points: 10, require_verified_email: true },
  daily_claim: { enabled: true, points: 1 },
  streak: { enabled: true, length_days: 7, bonus_points: 1, reset_policy: 'reset', grace_days: 0 },
  purchase: { enabled: true, rate_percent: 1, rounding: 'floor', max_points_per_order: null, hold_days: 7, include_points_funded_value: false },
  referral: {
    enabled: true, window_days: 30, hold_days: 7,
    tiers: [
      { min_ngn: 100, max_ngn: 200, points: 1 },
      { min_ngn: 200, max_ngn: 500, points: 2 },
      { min_ngn: 500, max_ngn: null, points: 5 },
    ],
  },
  redemption: { enabled: true, cap_percent: 10, min_points: 1, max_points_per_order: null, partial_allowed: true },
  expiry: { enabled: false, days: 365, warn_days: 30 },
  adjustments: { dual_approval_threshold_points: 500 },
});

describe('validatePolicy', () => {
  it('accepts a well-formed policy', () => {
    expect(validatePolicy(base())).toEqual({ ok: true, errors: [] });
  });

  it('rejects non-objects and wrong schema version', () => {
    expect(validatePolicy(null).ok).toBe(false);
    const p = base(); p.schema_version = 2;
    expect(validatePolicy(p).ok).toBe(false);
  });

  it('rejects gaps and overlaps between referral tiers', () => {
    const gap = base(); gap.referral.tiers[1].min_ngn = 250;
    expect(validatePolicy(gap).errors.join(' ')).toMatch(/contiguous/);
    const overlap = base(); overlap.referral.tiers[0].max_ngn = 300;
    expect(validatePolicy(overlap).ok).toBe(false);
  });

  it('requires the last tier to be open-ended and only the last', () => {
    const closed = base(); closed.referral.tiers[2].max_ngn = 900;
    expect(validatePolicy(closed).errors.join(' ')).toMatch(/open-ended/);
    const early = base(); early.referral.tiers[0].max_ngn = null;
    expect(validatePolicy(early).ok).toBe(false);
  });

  it('rejects bad numbers, rounding, timezone and percent caps', () => {
    for (const mutate of [
      (p: any) => { p.programme.points_to_ngn = 0; },
      (p: any) => { p.programme.timezone = 'Mars/Base'; },
      (p: any) => { p.redemption.cap_percent = 120; },
      (p: any) => { p.purchase.rounding = 'banker'; },
      (p: any) => { p.signup.points = 1.5; },
      (p: any) => { p.expiry.warn_days = 400; },
      (p: any) => { p.streak.reset_policy = 'grace'; },
    ]) {
      const p = base(); mutate(p);
      expect(validatePolicy(p).ok).toBe(false);
    }
  });

  it('needs a launch cutoff while the signup bonus is enabled', () => {
    const p = base(); p.programme.launch_at = null as any;
    expect(validatePolicy(p).ok).toBe(false);
    p.signup.enabled = false;
    expect(validatePolicy(p).ok).toBe(true);
  });
});

describe('referralTierFor', () => {
  const p = base();
  it('picks the band containing the amount', () => {
    expect(referralTierFor(p, 150)?.points).toBe(1);
    expect(referralTierFor(p, 200)?.points).toBe(2);
    expect(referralTierFor(p, 10_000)?.points).toBe(5);
  });
  it('returns null below the first band', () => {
    expect(referralTierFor(p, 50)).toBeNull();
  });
});
