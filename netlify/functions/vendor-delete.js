/**
 * vendor-delete.js — Admin only
 * Permanently deletes a vendor and all their associated data.
 *
 * Deletes:   products, product_variations, product_reviews, vendor_withdrawals,
 *            vendor_earnings_summary, vendor_monthly_earnings,
 *            approved_vendor_locations, vendor_location_waitlist,
 *            vendor_applications (matched by email), vendors row,
 *            Supabase Auth user (if vendor has a portal account).
 *
 * Preserves: sub_orders, order_items, global_sourcing_requests (vendor_id nulled out
 *            so order history is retained).
 *
 * POST /api/vendor-delete
 * Body: { vendor_id }
 */
import { corsHeaders, preflightResponse } from './services/cors.js';
import { requireAdmin } from './services/global-sourcing-utils.js';

export async function handler(event) {
  const origin = event.headers?.origin || event.headers?.Origin || '';
  if (event.httpMethod === 'OPTIONS') return preflightResponse(origin);
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders(origin),
      body: JSON.stringify({ success: false, error: 'Method not allowed' }),
    };
  }

  // Admin only — not managers
  const auth = await requireAdmin(event, ['admin']);
  if (auth.errorResponse) return auth.errorResponse;

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      headers: corsHeaders(origin),
      body: JSON.stringify({ success: false, error: 'Invalid JSON' }),
    };
  }

  const { vendor_id } = body;
  if (!vendor_id) {
    return {
      statusCode: 400,
      headers: corsHeaders(origin),
      body: JSON.stringify({ success: false, error: 'vendor_id is required' }),
    };
  }

  const { adminClient } = auth;

  // 1. Fetch the vendor so we have email + user_id before deleting
  const { data: vendor, error: fetchErr } = await adminClient
    .from('vendors')
    .select('id, email, user_id, store_name')
    .eq('id', vendor_id)
    .maybeSingle();

  if (fetchErr || !vendor) {
    return {
      statusCode: 404,
      headers: corsHeaders(origin),
      body: JSON.stringify({ success: false, error: 'Vendor not found' }),
    };
  }

  const errors = [];

  // 2. Null out vendor_id on order history (preserve customer records)
  for (const table of ['sub_orders', 'order_items', 'global_sourcing_requests', 'cj_inbound_shipments']) {
    const { error } = await adminClient.from(table).update({ vendor_id: null }).eq('vendor_id', vendor_id);
    if (error) errors.push(`${table}: ${error.message}`);
  }

  // 3. Delete vendor-owned content
  for (const table of [
    'product_reviews',
    'product_variations',
    'products',
    'vendor_withdrawals',
    'vendor_earnings_summary',
    'vendor_monthly_earnings',
    'approved_vendor_locations',
    'vendor_location_waitlist',
  ]) {
    const { error } = await adminClient.from(table).delete().eq('vendor_id', vendor_id);
    if (error) errors.push(`${table}: ${error.message}`);
  }

  // 4. Delete any vendor application records matched by email
  if (vendor.email) {
    const { error } = await adminClient
      .from('vendor_applications')
      .delete()
      .eq('email', vendor.email);
    if (error) errors.push(`vendor_applications: ${error.message}`);
  }

  // 5. Delete the vendors row itself
  const { error: vendorErr } = await adminClient.from('vendors').delete().eq('id', vendor_id);
  if (vendorErr) errors.push(`vendors: ${vendorErr.message}`);

  // 6. Delete Supabase Auth user (portal account)
  if (vendor.user_id) {
    const { error: authErr } = await adminClient.auth.admin.deleteUser(vendor.user_id);
    if (authErr) errors.push(`auth user: ${authErr.message}`);
  }

  if (errors.length > 0) {
    console.warn('[vendor-delete] Partial errors:', errors);
    return {
      statusCode: 207,
      headers: corsHeaders(origin),
      body: JSON.stringify({
        success: false,
        error: 'Some deletions failed',
        details: errors,
      }),
    };
  }

  console.log(`[vendor-delete] Vendor "${vendor.store_name}" (${vendor_id}) fully deleted`);
  return {
    statusCode: 200,
    headers: corsHeaders(origin),
    body: JSON.stringify({ success: true }),
  };
}
