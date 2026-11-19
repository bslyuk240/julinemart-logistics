/**
 * JulinePoints read capabilities for the Custom (public) API.
 *
 *   rewards.config.read            GET /api/v1/rewards/config
 *   rewards.summary.read           GET /api/v1/rewards/summary
 *   customers.rewards.read         GET /api/v1/customers/:id/rewards
 *   rewards.referrals.review.list  GET /api/v1/rewards/referrals/review
 *
 * STRICTLY READ-ONLY. These functions only SELECT. They must never call the
 * RPCs that open a wallet, claim a bonus or move points (rewards_ensure_wallet,
 * rewards_claim_signup, rewards_claim_daily, rewards_get_referral_code,
 * rewards_commit_reservation, rewards_reverse_order, rewards_restore_points,
 * ...): the customer-facing rewards-wallet endpoint does call some of those, so
 * its code must not be copied here. There is deliberately no write capability;
 * staff adjust and restore points in the admin page.
 *
 * Every function takes the service-role client and returns { status, body } so
 * public-api.js can wrap it with its own json() helper, and so the shapes can be
 * unit-tested without the router.
 *
 * Privacy: no email is ever returned. Referral partners are anonymised
 * ("Friend N") on the per-customer view; only the staff review queue names both
 * sides, and it carries no phone or address.
 */
import { getActiveConfig } from './rewards-config.js';
import { localDateString, currentStreak } from './rewards-dates.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LEDGER_LIMIT = 20;
const CLAIM_DAYS = 14;
const REVIEW_STATUSES = ['in_review', 'pending', 'available', 'void'];
const MAX_SIGNALS = 10;

const num = (v) => (v === null || v === undefined ? 0 : Number(v));
const pageParams = (query) => ({
  limit: Math.min(100, Math.max(1, Number(query?.limit) || 25)),
  offset: Math.max(0, Number(query?.offset) || 0),
});
const fullName = (c) => [c?.first_name, c?.last_name].filter(Boolean).join(' ').trim() || null;
const ngn = (points, rate) => Math.round(num(points) * num(rate) * 100) / 100;

/**
 * The programme settings an internal agent may read. Leaves out the staff
 * approval threshold for large manual adjustments.
 */
export function presentConfig(cfg) {
  const p = cfg.policy;
  return {
    enabled: p.programme.enabled === true,
    version: cfg.version,
    effective_from: cfg.effective_from,
    programme: {
      name: p.programme.name,
      timezone: p.programme.timezone,
      launch_at: p.programme.launch_at ?? null,
      points_to_ngn: p.programme.points_to_ngn,
    },
    signup: {
      enabled: p.signup.enabled === true,
      points: p.signup.points,
      require_verified_email: p.signup.require_verified_email === true,
    },
    daily_claim: { enabled: p.daily_claim.enabled === true, points: p.daily_claim.points },
    streak: {
      enabled: p.streak.enabled === true,
      length_days: p.streak.length_days,
      bonus_points: p.streak.bonus_points,
      reset_policy: p.streak.reset_policy,
      grace_days: p.streak.grace_days,
    },
    purchase: {
      enabled: p.purchase.enabled === true,
      rate_percent: p.purchase.rate_percent,
      rounding: p.purchase.rounding,
      hold_days: p.purchase.hold_days,
      max_points_per_order: p.purchase.max_points_per_order ?? null,
      include_points_funded_value: p.purchase.include_points_funded_value === true,
    },
    referral: {
      enabled: p.referral.enabled === true,
      window_days: p.referral.window_days,
      hold_days: p.referral.hold_days,
      tiers: (p.referral.tiers || []).map((t) => ({
        min_ngn: t.min_ngn,
        max_ngn: t.max_ngn ?? null,
        points: t.points,
      })),
    },
    redemption: {
      enabled: p.redemption.enabled === true,
      cap_percent: p.redemption.cap_percent,
      min_points: p.redemption.min_points,
      partial_allowed: p.redemption.partial_allowed === true,
      max_points_per_order: p.redemption.max_points_per_order ?? null,
    },
    expiry: { enabled: p.expiry.enabled === true, days: p.expiry.days },
  };
}

/** rewards.config.read */
export async function readRewardsConfig(adminClient) {
  let cfg;
  try {
    cfg = await getActiveConfig(adminClient);
  } catch (err) {
    return { status: 500, body: { error: err?.message || 'Could not read the rewards config' } };
  }
  if (!cfg) return { status: 200, body: { data: { enabled: false, version: null } } };
  return { status: 200, body: { data: presentConfig(cfg) } };
}

/** rewards.summary.read: programme-wide totals. No customer-level data. */
export async function readRewardsSummary(adminClient) {
  let cfg = null;
  try {
    cfg = await getActiveConfig(adminClient);
  } catch { /* summary still useful without it */ }
  const rate = cfg?.policy?.programme?.points_to_ngn ?? null;

  const [cost, accounts, drift, inReview] = await Promise.all([
    adminClient.from('rewards_cost_summary').select('*').maybeSingle(),
    adminClient.from('rewards_accounts').select('user_id', { count: 'exact', head: true }),
    adminClient.from('rewards_reconciliation').select('user_id', { count: 'exact', head: true }).neq('drift', 0),
    adminClient.from('rewards_referral_awards').select('id', { count: 'exact', head: true }).eq('status', 'in_review'),
  ]);
  for (const r of [cost, accounts, drift, inReview]) {
    if (r.error) return { status: 500, body: { error: r.error.message } };
  }

  const c = cost.data || {};
  return {
    status: 200,
    body: {
      data: {
        programme_enabled: cfg?.policy?.programme?.enabled === true,
        config_version: cfg?.version ?? null,
        points_to_ngn: rate,
        accounts: accounts.count ?? 0,
        issued_points: num(c.issued_points),
        issued_ngn: num(c.issued_ngn),
        redeemed_points: num(c.redeemed_points),
        redeemed_ngn: num(c.redeemed_ngn),
        restored_points: num(c.restored_points),
        restored_ngn: num(c.restored_ngn),
        adjusted_points: num(c.adjusted_points),
        expired_points: num(c.expired_points),
        outstanding_points: num(c.outstanding_points),
        outstanding_ngn: rate == null ? null : ngn(c.outstanding_points, rate),
        pending_points: num(c.pending_points),
        pending_ngn: rate == null ? null : ngn(c.pending_points, rate),
        referrals_awaiting_review: inReview.count ?? 0,
        // Accounts whose cached balance disagrees with their ledger. Should be 0.
        balance_drift_accounts: drift.count ?? 0,
      },
    },
  };
}

/**
 * customers.rewards.read. `customer` is a row already resolved by the router's
 * resolveCustomer (uuid or phone), so identity rules match customers.read.
 */
export async function readCustomerRewards(adminClient, customer) {
  const userId = customer.id;
  let cfg = null;
  try {
    cfg = await getActiveConfig(adminClient);
  } catch (err) {
    return { status: 500, body: { error: err?.message || 'Could not read the rewards config' } };
  }
  if (!cfg) return { status: 200, body: { data: { customer_id: userId, programme_enabled: false } } };

  const policy = cfg.policy;
  const rate = policy.programme.points_to_ngn;
  const tz = policy.programme.timezone;
  const today = localDateString(new Date(), tz);

  const { data: eligible, error: eligErr } = await adminClient.rpc('rewards_is_storefront_customer', { p_user: userId });
  if (eligErr) return { status: 500, body: { error: eligErr.message } };
  if (!eligible) {
    return {
      status: 200,
      body: { data: { customer_id: userId, programme_enabled: policy.programme.enabled === true, eligible: false, reason: 'not_a_storefront_customer' } },
    };
  }

  const [account, ledger, pendingPurchase, pendingReferral, claims, made, awards, referredBy, attempt, openHold] = await Promise.all([
    adminClient.from('rewards_accounts')
      .select('balance_points, reserved_points, lifetime_earned_points, referral_code, created_at')
      .eq('user_id', userId).maybeSingle(),
    adminClient.from('rewards_ledger')
      .select('id, entry_type, points, source, reference_type, reference_id, reason, created_at')
      .eq('user_id', userId).order('created_at', { ascending: false }).limit(LEDGER_LIMIT),
    adminClient.from('rewards_purchase_awards').select('points').eq('user_id', userId).eq('status', 'pending'),
    adminClient.from('rewards_referral_awards').select('points').eq('referrer_id', userId).in('status', ['pending', 'in_review']),
    adminClient.from('rewards_daily_claims')
      .select('claim_date, streak_count, points_awarded, streak_bonus_points')
      .eq('user_id', userId).order('claim_date', { ascending: false }).limit(CLAIM_DAYS),
    adminClient.from('rewards_referrals').select('referee_id, attributed_at')
      .eq('referrer_id', userId).order('attributed_at', { ascending: false }).limit(50),
    adminClient.from('rewards_referral_awards').select('referee_id, points, status').eq('referrer_id', userId),
    adminClient.from('rewards_referrals').select('id', { count: 'exact', head: true }).eq('referee_id', userId),
    adminClient.from('rewards_referral_attempts').select('outcome, reason, created_at')
      .eq('referee_id', userId).order('created_at', { ascending: false }).limit(1),
    adminClient.from('rewards_reservations').select('order_id, points, expires_at, status')
      .eq('user_id', userId).eq('status', 'reserved'),
  ]);
  for (const r of [account, ledger, pendingPurchase, pendingReferral, claims, made, awards, referredBy, attempt, openHold]) {
    if (r.error) return { status: 500, body: { error: r.error.message } };
  }

  const acct = account.data;
  const balance = num(acct?.balance_points);
  const reserved = num(acct?.reserved_points);
  const available = Math.max(balance - reserved, 0);
  const pendingPoints =
    (pendingPurchase.data || []).reduce((s, r) => s + num(r.points), 0) +
    (pendingReferral.data || []).reduce((s, r) => s + num(r.points), 0);

  const claimRows = claims.data || [];
  const awardByReferee = new Map((awards.data || []).map((a) => [a.referee_id, a]));
  const referrals = (made.data || []).map((r, i) => {
    const a = awardByReferee.get(r.referee_id);
    return {
      label: `Friend ${i + 1}`,
      joined_at: r.attributed_at,
      status: !a ? 'signed_up' : a.status,
      points: a ? num(a.points) : 0,
    };
  });

  return {
    status: 200,
    body: {
      data: {
        customer_id: userId,
        name: fullName(customer),
        programme_enabled: policy.programme.enabled === true,
        eligible: true,
        wallet: acct
          ? {
              balance_points: balance,
              reserved_points: reserved,
              available_points: available,
              available_ngn: ngn(available, rate),
              pending_points: pendingPoints,
              pending_ngn: ngn(pendingPoints, rate),
              lifetime_earned_points: num(acct.lifetime_earned_points),
              opened_at: acct.created_at,
            }
          : null,
        wallet_note: acct ? null : 'No wallet yet: this customer has not opened Rewards in the app.',
        // Points held on checkouts that are not paid yet.
        open_holds: (openHold.data || []).map((h) => ({ order_id: h.order_id, points: num(h.points), expires_at: h.expires_at })),
        daily: {
          enabled: policy.daily_claim.enabled === true,
          today,
          claimed_today: claimRows.some((c) => c.claim_date === today),
          streak: currentStreak(claimRows, today, policy.streak),
          last_claim_date: claimRows[0]?.claim_date ?? null,
        },
        referral: {
          enabled: policy.referral.enabled === true,
          code: acct?.referral_code ?? null,
          friends: referrals,
          earned_count: referrals.filter((r) => r.status === 'available').length,
          pending_count: referrals.filter((r) => ['signed_up', 'pending', 'in_review'].includes(r.status)).length,
          was_referred: (referredBy.count ?? 0) > 0,
          last_code_attempt: attempt.data?.[0] ?? null,
        },
        recent_ledger: (ledger.data || []).map((l) => ({
          id: l.id,
          entry_type: l.entry_type,
          points: num(l.points),
          source: l.source,
          reference_type: l.reference_type,
          reference_id: l.reference_id,
          reason: l.reason ? String(l.reason).slice(0, 200) : null,
          created_at: l.created_at,
        })),
        ledger_limit: LEDGER_LIMIT,
      },
    },
  };
}

/**
 * rewards.referrals.review.list: referral awards a person should look at.
 * Default is the review queue (status=in_review). Other statuses are allowed so
 * an agent can look at what already happened.
 */
export async function listReferralReview(adminClient, query) {
  const status = query?.status ? String(query.status) : 'in_review';
  if (!REVIEW_STATUSES.includes(status)) {
    return { status: 400, body: { error: `status must be one of: ${REVIEW_STATUSES.join(', ')}` } };
  }
  const { limit, offset } = pageParams(query);

  const { data, error, count } = await adminClient
    .from('rewards_referral_awards')
    .select('id, referrer_id, referee_id, order_id, qualifying_amount, points, status, void_reason, signals, created_at, vested_at, reviewed_at', { count: 'exact' })
    .eq('status', status)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) return { status: 500, body: { error: error.message } };

  const rows = data || [];
  const ids = [...new Set(rows.flatMap((r) => [r.referrer_id, r.referee_id]).filter((v) => UUID_RE.test(String(v))))];
  const names = new Map();
  if (ids.length) {
    const { data: custs, error: custErr } = await adminClient.from('customers').select('id, first_name, last_name').in('id', ids);
    if (custErr) return { status: 500, body: { error: custErr.message } };
    for (const c of custs || []) names.set(c.id, fullName(c));
  }

  return {
    status: 200,
    body: {
      data: rows.map((r) => ({
        id: r.id,
        status: r.status,
        points: num(r.points),
        qualifying_amount: num(r.qualifying_amount),
        order_id: r.order_id,
        referrer: { id: r.referrer_id, name: names.get(r.referrer_id) ?? null },
        referee: { id: r.referee_id, name: names.get(r.referee_id) ?? null },
        // Flag names only, e.g. same_phone_as_referrer. A flag is a reason to look, not proof.
        signals: Array.isArray(r.signals) ? r.signals.filter((s) => typeof s === 'string').slice(0, MAX_SIGNALS) : [],
        void_reason: r.void_reason ?? null,
        created_at: r.created_at,
        vested_at: r.vested_at ?? null,
        reviewed_at: r.reviewed_at ?? null,
      })),
      count: count ?? rows.length,
    },
  };
}
