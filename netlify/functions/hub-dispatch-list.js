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

    // Also fetch sub-orders from sub-hubs that route through this hub for Fez dispatch
    const { data: subHubRows } = await supabase
      .from('hubs')
      .select('id')
      .eq('parent_hub_id', hubId)
      .eq('is_sub_hub', true);

    const subHubIds = (subHubRows || []).map((h) => h.id);
    const allHubIds = [hubId, ...subHubIds];

    const { data, error } = await supabase
      .from('sub_orders')
      .select(
        `
          id,
          main_order_id,
          hub_id,
          vendor_id,
          courier_shipment_id,
          tracking_number,
          metadata,
          subtotal,
          status,
          items,
          vendors (
            store_name
          ),
          orders:main_order_id (
            woocommerce_order_id,
            order_number,
            customer_name,
            customer_phone,
            delivery_address,
            delivery_city,
            delivery_state
          )
        `
      )
      .in('hub_id', allHubIds)
      .order('created_at', { ascending: false })
      .limit(500);

    if (error) throw error;

    // Manual shipments whose destination hub is this hub (or one of its
    // sub-hubs) — either still needing a rider to bring them in, or already
    // sitting here ('at_hub') waiting for the onward dispatch decision.
    // Kept as a separate response key rather than merged into `data`: the
    // shapes don't line up (no main_order_id/vendors join to group by), and
    // manual shipments already have their own individual Fez-dispatch
    // action on their own detail page — this list is just for visibility
    // and first/second-leg rider assignment from the hub view.
    const { data: manualShipments, error: manualError } = await supabase
      .from('manual_shipments')
      .select(
        'id, shipment_code, tracking_number, status, item_description, item_value, sender, recipient, metadata, destination_hub_id, assigned_rider_id'
      )
      .in('destination_hub_id', allHubIds)
      .not('status', 'in', '(delivered,failed,returned)')
      .order('created_at', { ascending: false })
      .limit(500);

    if (manualError) throw manualError;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, data: data || [], manual_shipments: manualShipments || [] }),
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
