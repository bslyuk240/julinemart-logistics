/**
 * GET/PUT /api/vendor-profile
 * Returns or updates the authenticated vendor's profile.
 */
import { corsHeaders, preflightResponse } from './services/cors.js';
import { authenticateVendor, getAdminClient } from './services/vendorAuth.js';

export async function handler(event) {
  const origin = event.headers?.origin || event.headers?.Origin || '';
  if (event.httpMethod === 'OPTIONS') return preflightResponse(origin);

  const { vendor, userId, adminClient, error } = await authenticateVendor(event);
  if (error) return { statusCode: 401, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error }) };

  // ── GET ──────────────────────────────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    return {
      statusCode: 200,
      headers: corsHeaders(origin),
      body: JSON.stringify({ success: true, data: vendor }),
    };
  }

  // ── PUT ──────────────────────────────────────────────────────────────────
  if (event.httpMethod === 'PUT') {
    const body = event.body ? JSON.parse(event.body) : {};
    const allowed = ['phone', 'description', 'bank_name', 'bank_account_number', 'bank_account_name', 'logo_url', 'banner_url'];
    const updates = {};
    for (const key of allowed) {
      if (body[key] !== undefined) updates[key] = body[key];
    }

    const { data, error: updateErr } = await getAdminClient()
      .from('vendors')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', vendor.id)
      .select()
      .single();

    if (updateErr) return { statusCode: 500, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: updateErr.message }) };
    return { statusCode: 200, headers: corsHeaders(origin), body: JSON.stringify({ success: true, data }) };
  }

  return { statusCode: 405, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
}
