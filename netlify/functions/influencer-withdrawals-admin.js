/**
 * GET /api/influencer-withdrawals-admin — staff-facing list of all influencer
 * withdrawal requests. Mutating actions (approve/reject/paid) live in
 * influencer-withdrawals.js's PUT :id branch — same split as
 * vendor-withdrawals-admin.js / rider-withdrawals-admin.js.
 */
import { corsHeaders, preflightResponse } from './services/cors.js';
import { requireAdmin } from './services/global-sourcing-utils.js';

export async function handler(event) {
  const origin = event.headers?.origin || event.headers?.Origin || '';
  if (event.httpMethod === 'OPTIONS') return preflightResponse(origin);
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
  }

  const auth = await requireAdmin(event, ['admin', 'manager', 'staff']);
  if (auth.errorResponse) return auth.errorResponse;

  const { data, error } = await auth.adminClient
    .from('influencer_withdrawals')
    .select('*, influencer:influencers(name, email, coupon_code)')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) return { statusCode: 500, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: error.message }) };

  return { statusCode: 200, headers: corsHeaders(origin), body: JSON.stringify({ success: true, data }) };
}
