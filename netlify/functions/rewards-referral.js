/**
 * POST /api/rewards-referral   { code }
 *
 * Attributes the signed-in customer to a referrer's code. Called by the PWA
 * after signup/login when a ?ref= code was captured. Rules (own code, already
 * referred, outside the attribution window, existing customer with a paid
 * order, unknown code) are enforced in the database against the active
 * config; attribution is immutable once locked. Rejections are logged and
 * explained to the referee in plain words, with no data about the referrer.
 */
import { headers, jsonResponse, adminClient, parseJsonBody } from './services/global-sourcing-utils.js';
import { authenticateCustomer } from './services/customerAuth.js';
import { checkRateLimit } from './services/rate-limit.js';

const MESSAGES = {
  programme_disabled: 'Referrals are not available right now.',
  referrals_disabled: 'Referrals are not available right now.',
  missing_code: 'Enter a referral code.',
  not_eligible: 'This account cannot use a referral code.',
  unknown_code: 'That referral code was not found.',
  self_referral: 'You cannot use your own referral code.',
  already_referred: 'A referral code has already been applied to your account.',
  outside_attribution_window: 'This code can no longer be applied to your account.',
  existing_customer: 'Referral codes are for new customers who have not placed an order yet.',
};

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });
  if (!adminClient) return jsonResponse(503, { error: 'Database not configured' });

  const { limited, response } = await checkRateLimit(event, {
    name: 'rewards-referral',
    max: 10,
    window: '10 m',
    retryAfterSeconds: 600,
  });
  if (limited) return response;

  const { userId, error: authError } = await authenticateCustomer(event);
  if (authError) return jsonResponse(401, { success: false, error: 'Please sign in first.' });

  const body = parseJsonBody(event.body);
  const code = typeof body?.code === 'string' ? body.code.trim().slice(0, 32) : '';
  if (!code) return jsonResponse(400, { success: false, error: MESSAGES.missing_code });

  const { data, error } = await adminClient.rpc('rewards_register_referral', {
    p_referee: userId,
    p_code: code,
  });
  if (error) {
    console.error('rewards-referral error:', error.message);
    return jsonResponse(500, { success: false, error: 'Could not apply the referral code. Please try again.' });
  }
  if (!data?.ok) {
    return jsonResponse(200, {
      success: false,
      reason: data?.reason,
      error: MESSAGES[data?.reason] || 'This referral code could not be applied.',
    });
  }
  return jsonResponse(200, { success: true });
}
