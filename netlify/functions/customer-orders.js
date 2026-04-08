// Netlify Function: customer-orders
// GET ?email=...            → list orders for that customer email
// GET ?email=...&order_id=... → single order + order_items

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || ''
);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
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

  try {
    const qs = event.queryStringParameters || {};
    const email = (qs.email || '').toLowerCase().trim();
    const orderId = qs.order_id || null;

    if (!email) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: 'email is required' }),
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
          id, order_number, overall_status, payment_method,
          payment_reference, customer_name, customer_email, customer_phone,
          delivery_address, delivery_city, delivery_state,
          subtotal, shipping_fee_paid, discount_amount, total_amount,
          created_at, paid_at, updated_at,
          order_items (
            id, product_name, product_sku, variation_id, unit_price, quantity, subtotal
          ),
          sub_orders (
            id, status, tracking_number, courier_waybill, delivered_at,
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
      const subOrders = order.sub_orders || [];
      const { order_items: _ri, sub_orders: _rs, ...orderCore } = order;

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          data: { ...orderCore, items, sub_orders: subOrders },
        }),
      };
    }

    // -------------------------------------------------------
    // List mode: ?email=...
    // -------------------------------------------------------
    const { data: orders, error } = await supabase
      .from('orders')
      .select(`
        id, order_number, overall_status, payment_method,
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
