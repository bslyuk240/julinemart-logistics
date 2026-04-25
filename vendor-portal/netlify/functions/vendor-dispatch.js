/**
 * POST /.netlify/functions/vendor-dispatch
 * Vendor marks a sub_order as dispatched to hub.
 * Body: { sub_order_id }
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ANON_KEY     = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server not configured' }) };
  }

  // Authenticate vendor
  const auth = event.headers?.authorization || event.headers?.Authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : auth;
  if (!token) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid token' }) };

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: vendor, error: vendorErr } = await admin
    .from('vendors')
    .select('id, is_active')
    .eq('user_id', user.id)
    .single();
  if (vendorErr || !vendor) return { statusCode: 403, headers, body: JSON.stringify({ error: 'No vendor account' }) };
  if (!vendor.is_active)    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Vendor account inactive' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { sub_order_id } = body;
  if (!sub_order_id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'sub_order_id required' }) };

  // Fetch sub_order and verify ownership
  const { data: so, error: soErr } = await admin
    .from('sub_orders')
    .select('id, vendor_id, status, orders(order_number)')
    .eq('id', sub_order_id)
    .single();

  if (soErr || !so) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Order not found' }) };
  if (so.vendor_id !== vendor.id) return { statusCode: 403, headers, body: JSON.stringify({ error: 'Forbidden' }) };
  if (so.status !== 'pending') {
    return { statusCode: 400, headers, body: JSON.stringify({ error: `Cannot dispatch: order is already ${so.status}` }) };
  }

  const now = new Date().toISOString();

  // Update sub_order status
  const { error: updateErr } = await admin
    .from('sub_orders')
    .update({ status: 'vendor_dispatched', vendor_dispatched_at: now, updated_at: now })
    .eq('id', sub_order_id);

  if (updateErr) {
    // vendor_dispatched_at column may not exist yet — fall back without it
    const { error: updateErr2 } = await admin
      .from('sub_orders')
      .update({ status: 'vendor_dispatched', updated_at: now })
      .eq('id', sub_order_id);
    if (updateErr2) return { statusCode: 500, headers, body: JSON.stringify({ error: updateErr2.message }) };
  }

  // Log tracking event
  await admin.from('tracking_events').insert({
    sub_order_id,
    status: 'vendor_dispatched',
    description: 'Vendor has dispatched items to hub',
    actor_type: 'vendor',
    actor_id: vendor.id,
    created_at: now,
  });

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ success: true, message: 'Order marked as dispatched to hub' }),
  };
};
