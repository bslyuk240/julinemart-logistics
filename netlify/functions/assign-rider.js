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

function generateJloTracking() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let value = 'JLO-';
  for (let i = 0; i < 8; i++) {
    value += chars[Math.floor(Math.random() * chars.length)];
  }
  return value;
}

function shouldGenerateLocalTracking(value) {
  if (!value || typeof value !== 'string') return true;
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (/^(FEZ|CR)-/i.test(trimmed)) return true;
  if (/^[0-9a-f-]{36}$/i.test(trimmed)) return true;
  if (/error|cannot|failed|invalid|wrong|already exists/i.test(trimmed)) return true;
  return false;
}

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
    const { sub_order_id, rider_name, rider_phone, rider_vehicle } = JSON.parse(
      event.body || '{}'
    );

    if (!sub_order_id || !rider_name || !rider_phone) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Missing required fields: sub_order_id, rider_name, rider_phone',
        }),
      };
    }

    const { data: localCourier, error: courierError } = await supabase
      .from('couriers')
      .select('id')
      .eq('code', 'local-rider')
      .single();

    if (courierError || !localCourier) {
      console.error('Local courier lookup failed', courierError);
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Local rider courier not configured in system',
        }),
      };
    }

    const { data: existingSubOrder, error: existingSubOrderError } = await supabase
      .from('sub_orders')
      .select('id, tracking_number, metadata')
      .eq('id', sub_order_id)
      .single();

    if (existingSubOrderError || !existingSubOrder) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Sub-order not found',
        }),
      };
    }

    const nextTrackingNumber = shouldGenerateLocalTracking(existingSubOrder.tracking_number)
      ? generateJloTracking()
      : existingSubOrder.tracking_number;
    const existingMetadata =
      existingSubOrder.metadata &&
      typeof existingSubOrder.metadata === 'object' &&
      !Array.isArray(existingSubOrder.metadata)
        ? existingSubOrder.metadata
        : {};

    const { data: updatedSubOrder, error } = await supabase
      .from('sub_orders')
      .update({
        courier_id: localCourier.id,
        tracking_number: nextTrackingNumber,
        delivery_person_name: rider_name,
        delivery_person_phone: rider_phone,
        delivery_person_vehicle: rider_vehicle || null,
        status: 'assigned',
        rider_name: rider_name,
        rider_phone: rider_phone,
        metadata: {
          ...existingMetadata,
          selected_lane: 'local_rider',
          eligible_lanes:
            Array.isArray(existingMetadata.eligible_lanes) &&
            existingMetadata.eligible_lanes.length > 0
              ? existingMetadata.eligible_lanes
              : ['fez', 'local_rider'],
        },
      })
      .eq('id', sub_order_id)
      .select()
      .single();

    if (error) {
      console.error('Update sub_order error:', error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ success: false, error: error.message }),
      };
    }

    const riderDescription = `Assigned to local rider: ${rider_name} (${rider_phone})${
      rider_vehicle ? ` - ${rider_vehicle}` : ''
    }`;

    await supabase.from('tracking_events').insert({
      sub_order_id,
      status: 'assigned',
      description: riderDescription,
      actor_type: 'user',
      source: 'manual_assignment',
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, data: updatedSubOrder }),
    };
  } catch (error) {
    console.error('Assign rider function error:', error);
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
