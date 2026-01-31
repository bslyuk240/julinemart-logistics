import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

const ALLOWED_STATUSES = new Set(['out_for_delivery', 'delivered']);

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ success: false, error: 'Method Not Allowed' }),
    };
  }

  if (
    !process.env.SUPABASE_SERVICE_ROLE_KEY ||
    !(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL)
  ) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: 'Missing Supabase configuration' }),
    };
  }

  try {
    const { sub_order_id, status } = JSON.parse(event.body || '{}');

    if (!sub_order_id || !status) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Missing required fields: sub_order_id, status',
        }),
      };
    }

    if (!ALLOWED_STATUSES.has(status)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: `Status must be one of: ${Array.from(ALLOWED_STATUSES).join(', ')}`,
        }),
      };
    }

    const { data: subOrder, error: subOrderError } = await supabase
      .from('sub_orders')
      .select('id, courier_id')
      .eq('id', sub_order_id)
      .single();

    if (subOrderError || !subOrder) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ success: false, error: 'Sub-order not found' }),
      };
    }

    const { data: courier, error: courierError } = await supabase
      .from('couriers')
      .select('code')
      .eq('id', subOrder.courier_id)
      .maybeSingle();

    const courierCode = courier?.code?.toLowerCase();
    if (courierError || courierCode !== 'local-rider') {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Status updates are only allowed for local rider sub-orders',
        }),
      };
    }

    const { data: updated, error: updateError } = await supabase
      .from('sub_orders')
      .update({ status })
      .eq('id', sub_order_id)
      .select('id, status')
      .single();

    if (updateError) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ success: false, error: updateError.message }),
      };
    }

    const description =
      status === 'out_for_delivery'
        ? 'Local rider picked up the package and is out for delivery'
        : 'Local rider confirmed delivery';

    await supabase.from('tracking_events').insert({
      sub_order_id,
      status,
      description,
      actor_type: 'user',
      source: 'manual_assignment',
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, data: updated }),
    };
  } catch (error) {
    console.error('Local status update error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Internal server error',
        message: error?.message,
      }),
    };
  }
};
