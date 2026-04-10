/**
 * GET /api/vendor-withdrawals-admin
 * Admin-only: returns all vendor withdrawal requests with vendor info.
 * Uses service role key — requires a valid admin bearer token.
 */
import { corsHeaders, preflightResponse } from './services/cors.js';
import { getAdminClient } from './services/vendorAuth.js';
import { requireAdmin } from './services/global-sourcing-utils.js';

export async function handler(event) {
  const origin = event.headers?.origin || event.headers?.Origin || '';
  if (event.httpMethod === 'OPTIONS') return preflightResponse(origin);
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: 'Method not allowed' }) };

  const auth = await requireAdmin(event, ['admin', 'manager', 'staff']);
  if (auth.errorResponse) return auth.errorResponse;

  const adminClient = getAdminClient();
  const { data, error } = await adminClient
    .from('vendor_withdrawals')
    .select('*, vendor:vendors(store_name, email)')
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) return { statusCode: 500, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: error.message }) };
  return { statusCode: 200, headers: corsHeaders(origin), body: JSON.stringify({ success: true, data }) };
}
