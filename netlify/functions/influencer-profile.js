/**
 * GET/PUT /api/influencer-profile
 * Returns or updates the authenticated influencer's own profile.
 * Coupon terms (coupon_code, discounts, commission_rate, tier, status) are
 * staff-editable only — this endpoint never lets an influencer change them.
 */
import { corsHeaders, preflightResponse } from './services/cors.js';
import { authenticateInfluencer } from './services/influencerAuth.js';

const EDITABLE_FIELDS = ['phone', 'platform', 'handle', 'bank_name', 'account_number', 'account_name'];

export async function handler(event) {
  const origin = event.headers?.origin || event.headers?.Origin || '';
  if (event.httpMethod === 'OPTIONS') return preflightResponse(origin);

  const { influencer, adminClient, error } = await authenticateInfluencer(event);
  if (error) return { statusCode: 401, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error }) };

  // ── GET ──────────────────────────────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    return { statusCode: 200, headers: corsHeaders(origin), body: JSON.stringify({ success: true, data: influencer }) };
  }

  // ── PUT ──────────────────────────────────────────────────────────────────
  if (event.httpMethod === 'PUT') {
    const body = event.body ? JSON.parse(event.body) : {};
    const updates = {};
    for (const key of EDITABLE_FIELDS) {
      if (body[key] !== undefined) updates[key] = body[key];
    }

    if (Object.keys(updates).length === 0) {
      return { statusCode: 400, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: 'No editable fields provided' }) };
    }

    const { data, error: updateErr } = await adminClient
      .from('influencers')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', influencer.id)
      .select()
      .single();

    if (updateErr) return { statusCode: 500, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: updateErr.message }) };
    return { statusCode: 200, headers: corsHeaders(origin), body: JSON.stringify({ success: true, data }) };
  }

  return { statusCode: 405, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
}
