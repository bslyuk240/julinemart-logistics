/**
 * POST /api/notify-order-confirmation
 *
 * Secured hook for Supabase Database Webhooks on `public.orders` INSERT (PWA direct inserts).
 * The storefront on test-julinemart / julinemart often writes orders via Supabase client — it never
 * hits `create-order.js`, so this sends the same confirmation + vendor mails + email_logs rows.
 *
 * Configure in Supabase: Database → Webhooks → New → table `orders`, INSERT only,
 * URL: https://jlo.julinemart.com/api/notify-order-confirmation
 * HTTP Header: Authorization: Bearer <ORDER_EMAIL_WEBHOOK_SECRET>
 *
 * Orders created by `create-order` set metadata.order_confirmation_handler = 'netlify_create_order';
 * this handler skips those to avoid duplicate emails.
 */

import { headers, jsonResponse, adminClient } from './services/global-sourcing-utils.js';
import { sendOrderEmails } from '../../shared/orderConfirmationEmail.js';

const cors = {
  ...headers,
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function loadOrderItemsWithRetry(supabase, orderId) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const { data, error } = await supabase
      .from('order_items')
      .select('product_id, product_name, variation_details, vendor_id, hub_id, quantity, subtotal')
      .eq('order_id', orderId);
    if (error) {
      console.error('[notify-order-confirmation] order_items error:', error.message);
      return [];
    }
    if (data?.length) return data;
    await sleep(350);
  }
  return [];
}

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
    .select(
      'id, order_number, customer_name, customer_email, customer_phone, delivery_address, delivery_city, delivery_state, subtotal, discount_amount, shipping_fee_paid, total_amount, metadata',
    )
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
    console.log('[notify-order-confirmation] skip: create-order already owns confirmation', orderId);
    return jsonResponse(200, {
      success: true,
      skipped: true,
      reason: 'handled_by_netlify_create_order',
    });
  }

  const { data: dup } = await adminClient
    .from('email_logs')
    .select('id')
    .eq('order_id', orderId)
    .eq('status', 'sent')
    .ilike('subject', '%Confirmed - JulineMart%')
    .limit(1)
    .maybeSingle();

  if (dup) {
    return jsonResponse(200, { success: true, skipped: true, reason: 'confirmation_already_sent' });
  }

  const itemRows = await loadOrderItemsWithRetry(adminClient, orderId);
  const resolvedItems = (itemRows || []).map((row) => ({
    product_id: row.product_id,
    product_name: row.product_name,
    vendor_id: row.vendor_id,
    variation_details: row.variation_details || { attributes: [] },
    quantity: row.quantity,
    subtotal: Number(row.subtotal),
  }));

  console.log('[notify-order-confirmation] sending mail', orderId, 'items:', resolvedItems.length);

  await sendOrderEmails(adminClient, {
    orderId: order.id,
    orderNumber: order.order_number,
    customer_name: order.customer_name,
    customer_email: order.customer_email,
    customer_phone: order.customer_phone || '',
    delivery_address: order.delivery_address,
    delivery_city: order.delivery_city,
    delivery_state: order.delivery_state,
    subtotal: Number(order.subtotal),
    discountAmount: Number(order.discount_amount || 0),
    shippingFee: Number(order.shipping_fee_paid || 0),
    totalAmount: Number(order.total_amount),
    resolvedItems,
  });

  console.log('[notify-order-confirmation] sendOrderEmails finished', orderId);

  return jsonResponse(200, {
    success: true,
    order_id: order.id,
    items_used: resolvedItems.length,
  });
}
