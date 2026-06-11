/**
 * POST /api/notify-order-confirmation
 *
 * Secured hook for Supabase Database Webhooks on `public.orders` INSERT.
 * The storefront on test-julinemart / julinemart sometimes writes orders via Supabase client —
 * it never hits `create-order.js`, so this sends confirmation emails when payment is already paid
 * (e.g. WooCommerce orders inserted as processing/paid).
 *
 * Configure in Supabase: Database → Webhooks → New → table `orders`, INSERT only,
 * URL: https://jlo.julinemart.com/api/notify-order-confirmation
 * HTTP Header: Authorization: Bearer <ORDER_EMAIL_WEBHOOK_SECRET>
 *
 * Orders created by `create-order` set metadata.order_confirmation_handler = 'netlify_create_order';
 * PWA unpaid orders are notified after Paystack via paidOrderNotify (verify-payment / webhook).
 */

import { headers, jsonResponse, adminClient } from './services/global-sourcing-utils.js';
import { notifyOnPaidOrder } from './services/paidOrderNotify.js';

const cors = {
  ...headers,
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { success: false, error: 'Method not allowed' });
  }
  if (!adminClient) {
    return jsonResponse(503, { success: false, error: 'Database not configured' });
  }

  const secret = process.env.ORDER_EMAIL_WEBHOOK_SECRET;
  if (!secret || String(secret).trim() === '') {
    console.error('notify-order-confirmation: ORDER_EMAIL_WEBHOOK_SECRET is not set');
    return jsonResponse(503, {
      success: false,
      error: 'ORDER_EMAIL_WEBHOOK_SECRET not configured on Netlify',
    });
  }

  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  if (authHeader !== `Bearer ${secret}`) {
    return jsonResponse(401, { success: false, error: 'Unauthorized' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return jsonResponse(400, { success: false, error: 'Invalid JSON' });
  }

  const orderId =
    body.order_id ||
    body.record?.id ||
    (body.type === 'INSERT' && body.record?.id ? body.record.id : null);

  console.log('[notify-order-confirmation] payload keys:', Object.keys(body), 'orderId:', orderId);

  if (!orderId) {
    console.error('[notify-order-confirmation] missing order id; body sample:', JSON.stringify(body).slice(0, 500));
    return jsonResponse(400, { success: false, error: 'Missing order id (expected order_id or Supabase webhook record.id)' });
  }

  const { data: order, error: orderErr } = await adminClient
    .from('orders')
    .select('id, order_number, payment_status, metadata')
    .eq('id', orderId)
    .maybeSingle();

  if (orderErr) {
    console.error('[notify-order-confirmation] order load:', orderErr.message);
    return jsonResponse(500, { success: false, error: orderErr.message });
  }
  if (!order) {
    return jsonResponse(404, { success: false, error: 'Order not found' });
  }

  const meta = order.metadata && typeof order.metadata === 'object' ? order.metadata : {};
  if (meta.order_confirmation_handler === 'netlify_create_order') {
    console.log('[notify-order-confirmation] skip: create-order handles paid notify after Paystack', orderId);
    return jsonResponse(200, {
      success: true,
      skipped: true,
      reason: 'handled_by_netlify_create_order',
    });
  }

  if (order.payment_status !== 'paid') {
    console.log('[notify-order-confirmation] skip: awaiting payment', orderId);
    return jsonResponse(200, {
      success: true,
      skipped: true,
      reason: 'awaiting_payment',
    });
  }

  console.log('[notify-order-confirmation] notifying paid order', orderId);
  const result = await notifyOnPaidOrder(adminClient, order.id, order.order_number);

  return jsonResponse(200, {
    success: true,
    order_id: order.id,
    ...result,
  });
}
