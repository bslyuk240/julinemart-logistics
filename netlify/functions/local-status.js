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
      .select('id, courier_id, main_order_id')
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

    // refresh overall order status so customer card shows latest badge
    if (subOrder?.main_order_id) {
      const { data: order } = await supabase
        .from('orders')
        .select('overall_status')
        .eq('id', subOrder.main_order_id)
        .single();

      if (order) {
        const { data: statuses } = await supabase
          .from('sub_orders')
          .select('status')
          .eq('main_order_id', subOrder.main_order_id);

        if (statuses) {
          const priority = {
            pending: 1,
            processing: 2,
            assigned: 3,
            picked_up: 4,
            in_transit: 5,
            out_for_delivery: 6,
            delivered: 7,
            returned: 8,
            failed: 9,
            cancelled: 10,
          };

          const best = statuses.reduce((acc, so) => {
            if (!so?.status) return acc;
            const current = priority[so.status] ?? 0;
            return current > (priority[acc] ?? 0) ? so.status : acc;
          }, order.overall_status || 'pending');

          if (best && best !== order.overall_status) {
            await supabase
              .from('orders')
              .update({ overall_status: best })
              .eq('id', subOrder.main_order_id);
          }
        }
      }
    }

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
