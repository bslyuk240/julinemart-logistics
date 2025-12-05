// Create return requests via Netlify function

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
};

export async function handler(event) {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 200, headers, body: '' };
    }

    if (event.httpMethod !== 'POST') {
      return {
        statusCode: 405,
        headers,
        body: JSON.stringify({ success: false, error: `${event.httpMethod} not supported` }),
      };
    }

    const body = event.body ? JSON.parse(event.body) : {};
    const { woo_order_id, order_id, reason, status } = body;

    if (!woo_order_id && !order_id) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'woo_order_id or order_id is required' }),
      };
    }

    let jloOrderId = order_id;
    if (!jloOrderId && woo_order_id) {
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .select('id')
        .eq('woocommerce_order_id', woo_order_id)
        .single();

      if (orderError || !order) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ success: false, error: 'Order not found' }),
        };
      }
      jloOrderId = order.id;
    }

    const { data, error } = await supabase
      .from('return_requests')
      .insert({
        order_id: jloOrderId,
        reason: reason || null,
        status: status || 'pending',
      })
      .select('id')
      .single();

    if (error || !data) {
      console.error('create return_request error:', error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ success: false, error: 'Failed to create return request' }),
      };
    }

    return {
      statusCode: 201,
      headers,
      body: JSON.stringify({
        success: true,
        return_request_id: data.id,
      }),
    };
  } catch (error) {
    console.error('return-requests function error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: 'Server error creating return request' }),
    };
  }
}
