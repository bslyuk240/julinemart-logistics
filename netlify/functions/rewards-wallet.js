/**
 * GET /api/rewards-wallet
 *
 * Signed-in customer's JulinePoints wallet. Identity is the verified Supabase
 * auth user id from the Bearer JWT — never an email or a client-supplied id.
 *
 * Returns { enabled:false } when the programme is off or no config is active,
 * without creating a wallet. Staff and vendor accounts have no wallet.
 *
 * Opening the wallet also tries the one-time sign-up bonus (idempotent: the
 * database enforces once per account and the launch cutoff).
 */
import { headers, jsonResponse, adminClient } from './services/global-sourcing-utils.js';
import { authenticateCustomer } from './services/customerAuth.js';
import { checkRateLimit } from './services/rate-limit.js';
import { getActiveConfig, publicProgramme } from './services/rewards-config.js';
import { localDateString, currentStreak } from './services/rewards-dates.js';

const HISTORY_LIMIT = 50;
const CLAIM_DAYS = 14;

// Referrer-facing wording. Never exposes the other customer's identity.
const VOID_REASONS = {
  order_cancelled_or_refunded: 'The first order was cancelled or refunded.',
  rejected_in_review: 'This referral did not pass our checks.',
};

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'GET') return jsonResponse(405, { error: 'Method not allowed' });
  if (!adminClient) return jsonResponse(503, { error: 'Database not configured' });

  const { limited, response } = await checkRateLimit(event, {
    name: 'rewards-wallet',
    max: 60,
    window: '1 m',
    retryAfterSeconds: 60,
  });
  if (limited) return response;

  const { userId, error: authError } = await authenticateCustomer(event);
  if (authError) return jsonResponse(401, { success: false, error: 'Please sign in to view your rewards.' });

  try {
    const config = await getActiveConfig(adminClient);
    if (!config || config.policy?.programme?.enabled !== true) {
      return jsonResponse(200, { success: true, enabled: false });
    }

    const { data: eligible, error: eligErr } = await adminClient.rpc('rewards_is_storefront_customer', {
      p_user: userId,
    });
    if (eligErr) throw eligErr;
    if (!eligible) return jsonResponse(200, { success: true, enabled: false });

    const { data: wallet, error: walletErr } = await adminClient.rpc('rewards_ensure_wallet', {
      p_user_id: userId,
    });
    if (walletErr) throw walletErr;

    // One-time sign-up bonus; reasons like registered_before_launch are normal.
    const { data: signup } = await adminClient.rpc('rewards_claim_signup', { p_user: userId });
    const { data: referralCode } = await adminClient.rpc('rewards_get_referral_code', { p_user: userId });

    const policy = config.policy;
    const tz = policy.programme.timezone;
    const today = localDateString(new Date(), tz);

    const [accountRes, historyRes, claimsRes, pendingPurchase, pendingReferral, referralsRes, awardsRes, attemptRes] =
      await Promise.all([
        adminClient.from('rewards_accounts').select('balance_points, reserved_points, lifetime_earned_points').eq('user_id', userId).single(),
        adminClient.from('rewards_ledger')
          .select('id, entry_type, points, source, reference_type, created_at')
          .eq('user_id', userId).order('created_at', { ascending: false }).limit(HISTORY_LIMIT),
        adminClient.from('rewards_daily_claims')
          .select('claim_date, streak_count, points_awarded, streak_bonus_points')
          .eq('user_id', userId).order('claim_date', { ascending: false }).limit(CLAIM_DAYS),
        adminClient.from('rewards_purchase_awards').select('points').eq('user_id', userId).eq('status', 'pending'),
        adminClient.from('rewards_referral_awards').select('points').eq('referrer_id', userId).in('status', ['pending', 'in_review']),
        adminClient.from('rewards_referrals').select('id, referee_id, attributed_at').eq('referrer_id', userId)
          .order('attributed_at', { ascending: false }).limit(50),
        adminClient.from('rewards_referral_awards').select('referee_id, points, status, void_reason').eq('referrer_id', userId),
        adminClient.from('rewards_referral_attempts').select('outcome, reason, created_at')
          .eq('referee_id', userId).order('created_at', { ascending: false }).limit(1),
      ]);
    for (const r of [accountRes, historyRes, claimsRes, pendingPurchase, pendingReferral, referralsRes, awardsRes]) {
      if (r.error) throw r.error;
    }

    const programme = publicProgramme(policy);
    const account = accountRes.data;
    const balance = Math.max((account?.balance_points ?? 0) - (account?.reserved_points ?? 0), 0);
    const claims = claimsRes.data || [];
    const claimedToday = claims.some((c) => c.claim_date === today);
    const pendingPoints =
      (pendingPurchase.data || []).reduce((s, r) => s + r.points, 0) +
      (pendingReferral.data || []).reduce((s, r) => s + r.points, 0);

    const awardByReferee = new Map((awardsRes.data || []).map((a) => [a.referee_id, a]));
    const referrals = (referralsRes.data || []).map((r, i) => {
      const a = awardByReferee.get(r.referee_id);
      return {
        label: `Friend ${i + 1}`,
        joined_at: r.attributed_at,
        status: !a ? 'signed_up' : a.status === 'in_review' ? 'pending' : a.status,
        points: a ? a.points : 0,
        note: a?.status === 'void' ? VOID_REASONS[a.void_reason] || 'This referral did not qualify.' : null,
      };
    });

    return jsonResponse(200, {
      success: true,
      enabled: true,
      programme,
      wallet: {
        available_points: balance,
        available_ngn: Math.round(balance * programme.points_to_ngn * 100) / 100,
        pending_points: pendingPoints,
        pending_ngn: Math.round(pendingPoints * programme.points_to_ngn * 100) / 100,
        lifetime_earned_points: account?.lifetime_earned_points ?? 0,
      },
      signup_bonus: signup?.awarded ? { points: signup.points } : null,
      daily: {
        enabled: programme.daily_claim.enabled,
        today,
        claimed_today: claimedToday,
        streak: currentStreak(claims, today, policy.streak),
        recent_claim_dates: claims.map((c) => c.claim_date),
      },
      referral: {
        enabled: policy.referral.enabled === true,
        code: referralCode || null,
        tiers: (policy.referral.tiers || []).map((t) => ({ min_ngn: t.min_ngn, max_ngn: t.max_ngn, points: t.points })),
        referrals,
        confirmed_count: referrals.filter((r) => r.status === 'available').length,
        pending_count: referrals.filter((r) => r.status === 'pending' || r.status === 'signed_up').length,
        my_referral_attempt: attemptRes.data?.[0] || null,
      },
      history: historyRes.data || [],
    });
  } catch (err) {
    console.error('rewards-wallet error:', err?.message || err);
    return jsonResponse(500, { success: false, error: 'Could not load your rewards. Please try again.' });
  }
}
