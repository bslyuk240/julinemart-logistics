/**
 * JulinePoints — config policy validation and resolution.
 *
 * The policy JSON is stored in rewards_config_versions.policy and edited from
 * JLO admin. This module owns the SHAPE and the sanity rules; it holds no
 * reward amounts, thresholds or dates (PRD §8). Defaults for new drafts are
 * copied from the currently active version, never from constants here.
 */

const ROUNDING = ['floor', 'round', 'ceil'];
const STREAK_RESET = ['reset', 'grace'];

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isInt = (v) => Number.isInteger(v);

function checkTimezone(tz) {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate a policy object. Returns { ok, errors: string[] }.
 * Pure function: safe to unit test and to run in the browser form too.
 */
export function validatePolicy(policy) {
  const errors = [];
  const err = (msg) => errors.push(msg);

  if (!isObj(policy)) return { ok: false, errors: ['policy must be an object'] };
  if (policy.schema_version !== 1) err('schema_version must be 1');

  for (const section of [
    'programme', 'signup', 'daily_claim', 'streak', 'purchase',
    'referral', 'redemption', 'expiry', 'adjustments',
  ]) {
    if (!isObj(policy[section])) err(`${section} section is required`);
  }
  if (errors.length) return { ok: false, errors };

  const nonNegInt = (path, v) => {
    if (!isInt(v) || v < 0) err(`${path} must be a whole number >= 0`);
  };
  const posInt = (path, v) => {
    if (!isInt(v) || v < 1) err(`${path} must be a whole number >= 1`);
  };
  const bool = (path, v) => {
    if (typeof v !== 'boolean') err(`${path} must be true or false`);
  };
  const optPosInt = (path, v) => {
    if (v !== null && v !== undefined && (!isInt(v) || v < 1)) {
      err(`${path} must be empty or a whole number >= 1`);
    }
  };

  const p = policy.programme;
  bool('programme.enabled', p.enabled);
  if (typeof p.name !== 'string' || !p.name.trim() || p.name.length > 40) {
    err('programme.name must be 1-40 characters');
  }
  if (p.launch_at != null && Number.isNaN(Date.parse(p.launch_at))) {
    err('programme.launch_at must be a valid date-time or empty');
  }
  if (typeof p.timezone !== 'string' || !checkTimezone(p.timezone)) {
    err('programme.timezone must be a valid IANA timezone');
  }
  if (!isNum(p.points_to_ngn) || p.points_to_ngn <= 0) {
    err('programme.points_to_ngn must be a number > 0');
  }
  if (p.enabled === true && p.launch_at == null) {
    // Without a launch cutoff the "new accounts only" signup rule is undefined.
    if (policy.signup.enabled === true) {
      err('programme.launch_at is required while signup bonus is enabled');
    }
  }

  bool('signup.enabled', policy.signup.enabled);
  nonNegInt('signup.points', policy.signup.points);
  bool('signup.require_verified_email', policy.signup.require_verified_email);

  bool('daily_claim.enabled', policy.daily_claim.enabled);
  nonNegInt('daily_claim.points', policy.daily_claim.points);

  const s = policy.streak;
  bool('streak.enabled', s.enabled);
  posInt('streak.length_days', s.length_days);
  nonNegInt('streak.bonus_points', s.bonus_points);
  if (!STREAK_RESET.includes(s.reset_policy)) err('streak.reset_policy must be reset or grace');
  nonNegInt('streak.grace_days', s.grace_days);
  if (s.reset_policy === 'grace' && s.grace_days < 1) {
    err('streak.grace_days must be >= 1 when reset_policy is grace');
  }

  const pu = policy.purchase;
  bool('purchase.enabled', pu.enabled);
  if (!isNum(pu.rate_percent) || pu.rate_percent < 0 || pu.rate_percent > 100) {
    err('purchase.rate_percent must be between 0 and 100');
  }
  if (!ROUNDING.includes(pu.rounding)) err('purchase.rounding must be floor, round or ceil');
  optPosInt('purchase.max_points_per_order', pu.max_points_per_order);
  nonNegInt('purchase.hold_days', pu.hold_days);
  bool('purchase.include_points_funded_value', pu.include_points_funded_value);

  const r = policy.referral;
  bool('referral.enabled', r.enabled);
  nonNegInt('referral.window_days', r.window_days);
  nonNegInt('referral.hold_days', r.hold_days);
  if (!Array.isArray(r.tiers) || r.tiers.length === 0) {
    err('referral.tiers needs at least one tier');
  } else {
    const tiers = r.tiers;
    tiers.forEach((t, i) => {
      if (!isObj(t)) return err(`referral.tiers[${i}] must be an object`);
      if (!isNum(t.min_ngn) || t.min_ngn < 0) err(`referral.tiers[${i}].min_ngn must be >= 0`);
      if (t.max_ngn !== null && (!isNum(t.max_ngn) || t.max_ngn <= t.min_ngn)) {
        err(`referral.tiers[${i}].max_ngn must be empty or greater than min_ngn`);
      }
      nonNegInt(`referral.tiers[${i}].points`, t.points);
    });
    // Bands must be contiguous and non-overlapping: each tier starts where the
    // previous one ends, and only the last tier is open-ended.
    for (let i = 0; i < tiers.length - 1; i += 1) {
      if (tiers[i].max_ngn === null) err(`referral.tiers[${i}] is open-ended but is not the last tier`);
      else if (tiers[i].max_ngn !== tiers[i + 1].min_ngn) {
        err(`referral.tiers[${i}] ends at ${tiers[i].max_ngn} but tier ${i + 1} starts at ${tiers[i + 1].min_ngn}; bands must be contiguous with no overlap`);
      }
    }
    if (tiers[tiers.length - 1].max_ngn !== null) {
      err('the last referral tier must be open-ended (empty max_ngn) so every larger order is covered');
    }
  }

  const rd = policy.redemption;
  bool('redemption.enabled', rd.enabled);
  if (!isNum(rd.cap_percent) || rd.cap_percent < 0 || rd.cap_percent > 100) {
    err('redemption.cap_percent must be between 0 and 100');
  }
  posInt('redemption.min_points', rd.min_points);
  optPosInt('redemption.max_points_per_order', rd.max_points_per_order);
  bool('redemption.partial_allowed', rd.partial_allowed);
  optPosInt('redemption.reservation_minutes', rd.reservation_minutes);

  bool('expiry.enabled', policy.expiry.enabled);
  posInt('expiry.days', policy.expiry.days);
  nonNegInt('expiry.warn_days', policy.expiry.warn_days);
  if (policy.expiry.warn_days >= policy.expiry.days) err('expiry.warn_days must be less than expiry.days');

  nonNegInt('adjustments.dual_approval_threshold_points', policy.adjustments.dual_approval_threshold_points);

  return { ok: errors.length === 0, errors };
}

/** Referral reward for an eligible order amount, or null when below the first band. */
export function referralTierFor(policy, amountNgn) {
  const tiers = policy?.referral?.tiers || [];
  return (
    tiers.find((t) => amountNgn >= t.min_ngn && (t.max_ngn === null || amountNgn < t.max_ngn)) || null
  );
}

/** Active config row at `at`, or null if none has taken effect. */
export async function getActiveConfig(client, at = new Date()) {
  const { data, error } = await client.rpc('rewards_active_config', { p_at: at.toISOString() });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row && row.id ? row : null;
}

/** The fields a customer may see (never internal caps or fraud thresholds). */
export function publicProgramme(policy) {
  return {
    name: policy.programme.name,
    points_to_ngn: policy.programme.points_to_ngn,
    timezone: policy.programme.timezone,
    daily_claim: { enabled: policy.daily_claim.enabled, points: policy.daily_claim.points },
    streak: {
      enabled: policy.streak.enabled,
      length_days: policy.streak.length_days,
      bonus_points: policy.streak.bonus_points,
    },
    redemption: {
      enabled: policy.redemption.enabled,
      cap_percent: policy.redemption.cap_percent,
      min_points: policy.redemption.min_points,
      partial_allowed: policy.redemption.partial_allowed,
    },
    expiry: { enabled: policy.expiry.enabled, days: policy.expiry.days },
  };
}
