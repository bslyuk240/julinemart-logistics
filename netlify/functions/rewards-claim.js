/**
 * POST /api/rewards-claim
 *
 * Manual daily claim. A login alone earns nothing; the customer presses the
 * button. The database decides "today" in the programme timezone and enforces
 * one claim per account per local date atomically, so concurrent taps or two
 * devices produce exactly one award; the loser gets already_claimed:true.
 */
import { headers, jsonResponse, adminClient } from './services/global-sourcing-utils.js';
import { authenticateCustomer } from './services/customerAuth.js';
import { checkRateLimit } from './services/rate-limit.js';

const FRIENDLY = {
  rewards_disabled: 'JulinePoints is not available right now.',
  daily_claim_disabled: 'Daily rewards are not available right now.',
  not_eligible: 'This account cannot earn JulinePoints.',
};

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });
  if (!adminClient) return jsonResponse(503, { error: 'Database not configured' });

  const { limited, response } = await checkRateLimit(event, {
    name: 'rewards-claim',
    max: 10,
    window: '1 m',
    retryAfterSeconds: 60,
  });
  if (limited) return response;

  const { userId, error: authError } = await authenticateCustomer(event);
  if (authError) return jsonResponse(401, { success: false, error: 'Please sign in to claim your reward.' });

  const { data, error } = await adminClient.rpc('rewards_claim_daily', { p_user: userId });
  if (error) {
    const key = Object.keys(FRIENDLY).find((k) => String(error.message || '').includes(k));
    if (key) return jsonResponse(409, { success: false, code: key, error: FRIENDLY[key] });
    console.error('rewards-claim error:', error.message);
    return jsonResponse(500, { success: false, error: 'Could not claim your reward. Please try again.' });
  }
  return jsonResponse(200, { success: true, claim: data });
}
