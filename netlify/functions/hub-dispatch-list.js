import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || ''
);

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
};

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ success: false, error: 'Method not allowed' }),
    };
  }

  try {
    const rawUrl =
      event.rawUrl ||
      `http://localhost${event.path}${event.queryStringParameters ? `?${new URLSearchParams(event.queryStringParameters).toString()}` : ''}`;
    const url = new URL(rawUrl);
    const hubId = url.searchParams.get('hubId');

    if (!hubId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'hubId is required' }),
      };
    }

    const { data, error } = await supabase
      .from('sub_orders')
      .select(
        `
          id,
          hub_id,
          courier_shipment_id,
          tracking_number,
          metadata,
          subtotal,
          orders:main_order_id(
            woocommerce_order_id,
            customer_name,
            customer_phone,
            delivery_address,
            delivery_city,
            delivery_state
          )
        `
      )
      .eq('hub_id', hubId)
      .order('created_at', { ascending: false })
      .limit(500);

    if (error) {
      throw error;
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, data: data || [] }),
    };
  } catch (error) {
    console.error('hub-dispatch-list error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: error?.message || 'Failed to fetch hub dispatch list',
      }),
    };
  }
}
