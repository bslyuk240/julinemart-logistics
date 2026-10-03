// Netlify Function: customer-orders
// Requires the customer's login (Authorization: Bearer <supabase token>).
// GET                       → list the signed-in customer's orders
// GET ?order_id=...         → single order + order_items
// ?email= is optional and, if sent, must match the signed-in customer.

import { createClient } from '@supabase/supabase-js';
import { checkRateLimit } from './services/rate-limit.js';
import { isOrderCancellable } from './services/cancellation-rules.js';
import { authenticateCustomer } from './services/customerAuth.js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || ''
);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: 'Method not allowed' }),
    };
  }

  const { limited, response } = await checkRateLimit(event, {
    name: 'customer-orders',
    max: 15,
    window: '5 m',
    retryAfterSeconds: 300,
  });
  if (limited) return response;

  // The caller must be signed in, and can only read their own orders. The email
  // comes from the verified login, never from the query string: this used to
  // trust ?email=, so anyone who knew an email and a (sequential) order number
  // could read that customer's name, phone, address and items.
  const { email, error: authError } = await authenticateCustomer(event);
  if (authError) {
    return {
      statusCode: 401,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: 'Sign in required' }),
    };
  }

  try {
    const qs = event.queryStringParameters || {};
    const requestedEmail = (qs.email || '').toLowerCase().trim();
    const orderId = qs.order_id || null;

    if (requestedEmail && requestedEmail !== email) {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: 'You can only view your own orders' }),
      };
    }

    // -------------------------------------------------------
    // Single order mode: ?email=...&order_id=...
    // -------------------------------------------------------
    if (orderId) {
      const isUUID = /^[0-9a-f-]{36}$/i.test(orderId);

      let query = supabase
        .from('orders')
        .select(`
          id, order_number, overall_status, payment_method, payment_status,
          payment_reference, customer_name, customer_email, customer_phone,
          delivery_address, delivery_city, delivery_state,
          fulfillment_method, reservation_status, reserved_until,
          reservation_ready_at, reservation_collected_at,
          subtotal, shipping_fee_paid, discount_amount, total_amount,
          created_at, paid_at, updated_at,
          order_items (
            id, product_id, product_name, product_sku, variation_id, unit_price, quantity, subtotal,
            warranty_type, warranty_months
          ),
          sub_orders (
            id, status, tracking_number, courier_waybill, delivered_at,
            courier_shipment_id, assigned_rider_id,
            couriers ( name, code ),
            hubs ( name, city )
          )
        `)
        .eq('customer_email', email);

      if (isUUID) {
        query = query.eq('id', orderId);
      } else {
        const orderNumber = parseInt(orderId, 10);
        if (Number.isNaN(orderNumber)) {
          return {
            statusCode: 400,
            headers: corsHeaders,
            body: JSON.stringify({ success: false, error: 'Invalid order_id' }),
          };
        }
        query = query.eq('order_number', orderNumber);
      }

      const { data: order, error } = await query.maybeSingle();

      if (error) {
        console.error('Supabase error (single order):', error);
        return {
          statusCode: 500,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'Failed to fetch order' }),
        };
      }

      if (!order) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'Order not found' }),
        };
      }

      const items = order.order_items || [];
      const { order_items: _ri, sub_orders: _rs, ...orderCore } = order;

      // Same rule cancel-order enforces, so the storefront can hide the Cancel
      // button once a shipment or rider exists. The internal courier/rider ids
      // are used for that check only and are not sent to the client.
      const canCancel = isOrderCancellable(order);
      const subOrders = (order.sub_orders || []).map(
        ({ courier_shipment_id: _cs, assigned_rider_id: _ar, ...rest }) => rest
      );

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          data: { ...orderCore, items, sub_orders: subOrders, can_cancel: canCancel },
        }),
      };
    }

    // -------------------------------------------------------
    // List mode: ?email=...
    // -------------------------------------------------------
    const { data: orders, error } = await supabase
      .from('orders')
      .select(`
        id, order_number, overall_status, payment_method, payment_status,
        payment_reference, customer_name, customer_email, customer_phone,
        delivery_address, delivery_city, delivery_state,
        subtotal, shipping_fee_paid, discount_amount, total_amount,
        created_at, paid_at, updated_at,
        sub_orders (
          id, status, tracking_number, courier_waybill, delivered_at,
          couriers ( name, code ),
          hubs ( name, city )
        )
      `)
      .eq('customer_email', email)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error('Supabase error (list):', error);
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: 'Failed to fetch orders' }),
      };
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ success: true, data: orders || [] }),
    };
  } catch (err) {
    console.error('Unexpected error in customer-orders:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: 'Internal server error' }),
    };
  }
}
