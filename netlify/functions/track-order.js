/**
 * GET /.netlify/functions/track-order?orderNumber=1015&email=customer@example.com
 *
 * Public endpoint — no authentication required.
 * Looks up an order by order_number (or legacy woocommerce_order_id) + customer email.
 */

import { adminClient } from './services/global-sourcing-utils.js';

const corsHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders, body: '' };
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
  }

  const { orderNumber, email } = event.queryStringParameters || {};

  if (!adminClient) {
    return { statusCode: 503, headers: corsHeaders, body: JSON.stringify({ success: false, error: 'Database not configured' }) };
  }

  if (!orderNumber || !email) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: 'orderNumber and email are required' }),
    };
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const subSelect = `
    id,
    status,
    tracking_number,
    courier_waybill,
    allocated_shipping_fee,
    estimated_delivery_date,
    created_at,
    updated_at,
    hubs ( name, city, state ),
    couriers ( name, code )
  `;

  // 1. Try matching by order_number (new Supabase-native orders)
  let { data: order, error } = await adminClient
    .from('orders')
    .select(`
      id, order_number, customer_name, customer_email, customer_phone,
      delivery_address, delivery_city, delivery_state,
      total_amount, shipping_fee_paid, discount_amount, subtotal,
      overall_status, payment_status, payment_method, created_at,
      sub_orders ( ${subSelect} )
    `)
    .eq('order_number', Number(orderNumber))
    .eq('customer_email', normalizedEmail)
    .maybeSingle();

  // 2. Fallback: legacy woocommerce_order_id
  if (!order) {
    const res2 = await adminClient
      .from('orders')
      .select(`
        id, order_number, customer_name, customer_email, customer_phone,
        delivery_address, delivery_city, delivery_state,
        total_amount, shipping_fee_paid, discount_amount, subtotal,
        overall_status, payment_status, payment_method, created_at,
        sub_orders ( ${subSelect} )
      `)
      .eq('woocommerce_order_id', String(orderNumber))
      .eq('customer_email', normalizedEmail)
      .maybeSingle();
    order = res2.data;
    error = res2.error;
  }

  if (error || !order) {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: false,
        error: 'Order not found. Please check your order number and email address.',
      }),
    };
  }

  // Determine overall progress from sub_orders
  const SUB_STATUS_RANK = {
    pending: 1, assigned: 2, pickup_scheduled: 2,
    in_transit: 3, out_for_delivery: 4, delivered: 5,
  };
  const subOrders = order.sub_orders || [];
  const ranks = subOrders.map((s) => SUB_STATUS_RANK[s.status] ?? 1);
  const allDelivered = ranks.length > 0 && ranks.every((r) => r === 5);
  const derivedStatus = allDelivered
    ? 'delivered'
    : order.overall_status || 'pending';

  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({
      success: true,
      data: {
        ...order,
        derived_status: derivedStatus,
        sub_orders: subOrders,
      },
    }),
  };
}
