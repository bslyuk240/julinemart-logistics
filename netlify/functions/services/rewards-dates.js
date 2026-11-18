/**
 * Programme-local date helpers. The database is authoritative for claim dates
 * (rewards_claim_daily computes the date in the configured timezone); these
 * only mirror it for display so the wallet can show "claimed today".
 */

/** YYYY-MM-DD for `date` in the IANA timezone `tz`. */
export function localDateString(date, tz) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

function dayDiff(a, b) {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
}

/**
 * Display streak: the last claim's streak_count while it can still continue
 * (claimed today, or the miss is within the configured grace), else 0.
 * `claims` is newest-first.
 */
export function currentStreak(claims, today, streakPolicy) {
  const last = claims?.[0];
  if (!last) return 0;
  const gap = dayDiff(today, last.claim_date);
  const allowed = streakPolicy?.reset_policy === 'grace' ? 1 + (streakPolicy.grace_days || 0) : 1;
  return gap <= allowed ? last.streak_count : 0;
}
