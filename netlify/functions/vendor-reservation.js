/**
 * POST /api/vendor-reservation
 * Vendor actions on reserve & collect orders: mark ready or collected.
 *
 * Body: { order_id: uuid, action: 'ready' | 'collected' }
 */
import { corsHeaders, preflightResponse } from './services/cors.js';
import { authenticateVendor } from './services/vendorAuth.js';

export async function handler(event) {
  const origin = event.headers?.origin || event.headers?.Origin || '';
  if (event.httpMethod === 'OPTIONS') return preflightResponse(origin);
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
  }

  const { vendor, adminClient, error: authErr } = await authenticateVendor(event);
  if (authErr) {
    return { statusCode: 401, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: authErr }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: 'Invalid JSON' }) };
  }

  const orderId = body.order_id;
  const action = String(body.action || '').toLowerCase();
  if (!orderId) {
    return { statusCode: 400, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: 'order_id required' }) };
  }
  if (!['ready', 'collected'].includes(action)) {
    return { statusCode: 400, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: 'action must be ready or collected' }) };
  }

  const { data: order, error: orderErr } = await adminClient
    .from('orders')
    .select('id, order_number, fulfillment_method, reservation_status, payment_status, reserved_until')
    .eq('id', orderId)
    .maybeSingle();

  if (orderErr || !order) {
    return { statusCode: 404, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: 'Order not found' }) };
  }

  if (order.fulfillment_method !== 'reservation') {
    return { statusCode: 400, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: 'Not a reservation order' }) };
  }

  const { data: subOrder } = await adminClient
    .from('sub_orders')
    .select('id, vendor_id')
    .eq('main_order_id', orderId)
    .eq('vendor_id', vendor.id)
    .maybeSingle();

  if (!subOrder) {
    return { statusCode: 403, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: 'Forbidden' }) };
  }

  const now = new Date().toISOString();
  const updates = { updated_at: now };

  if (action === 'ready') {
    if (order.reservation_status !== 'reserved') {
      return { statusCode: 400, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: 'Reservation is not in reserved state' }) };
    }
    if (order.payment_status !== 'paid') {
      return { statusCode: 400, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: 'Order must be paid before marking ready' }) };
    }
    updates.reservation_status = 'ready';
    updates.reservation_ready_at = now;
  } else {
    if (order.reservation_status !== 'ready') {
      return { statusCode: 400, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: 'Reservation must be ready before collection' }) };
    }
    updates.reservation_status = 'collected';
    updates.reservation_collected_at = now;
    updates.overall_status = 'delivered';
  }

  const { error: updErr } = await adminClient.from('orders').update(updates).eq('id', orderId);
  if (updErr) {
    return { statusCode: 500, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: updErr.message }) };
  }

  return {
    statusCode: 200,
    headers: corsHeaders(origin),
    body: JSON.stringify({
      success: true,
      data: {
        order_id: orderId,
        order_number: order.order_number,
        reservation_status: updates.reservation_status,
      },
    }),
  };
}
