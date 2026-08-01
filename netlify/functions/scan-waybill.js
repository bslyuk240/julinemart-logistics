import { createClient } from '@supabase/supabase-js';
import { assertStaffCanReadShipments } from './services/shipmentAccess.js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '',
);

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
};

const SUB_ORDER_SELECT = `
  id,
  main_order_id,
  hub_id,
  tracking_number,
  courier_waybill,
  waybill_number,
  metadata,
  vendors ( store_name ),
  orders:main_order_id (
    woocommerce_order_id,
    order_number,
    customer_name,
    delivery_city,
    delivery_state
  )
`;

const MANUAL_SELECT =
  'id, shipment_code, recipient, sender, status, tracking_number, waybill_number, courier_waybill, sender_hub_id';

async function hubIdsForDispatch(hubId) {
  const { data: subHubRows } = await supabase
    .from('hubs')
    .select('id')
    .eq('parent_hub_id', hubId)
    .eq('is_sub_hub', true);

  const subHubIds = (subHubRows || []).map((h) => h.id);
  return [hubId, ...subHubIds];
}

async function findSubOrder(code, allHubIds) {
  const ref = String(code || '').trim();
  if (!ref) return null;

  for (const field of ['tracking_number', 'courier_waybill', 'waybill_number']) {
    const { data } = await supabase
      .from('sub_orders')
      .select(SUB_ORDER_SELECT)
      .eq(field, ref)
      .in('hub_id', allHubIds)
      .maybeSingle();

    if (data) return data;
  }

  return null;
}

async function findManualShipment(code) {
  const ref = String(code || '').trim();
  if (!ref) return null;

  const selectors = [
    () => supabase.from('manual_shipments').select(MANUAL_SELECT).eq('waybill_number', ref).maybeSingle(),
    () => supabase.from('manual_shipments').select(MANUAL_SELECT).eq('tracking_number', ref).maybeSingle(),
    () => supabase.from('manual_shipments').select(MANUAL_SELECT).eq('courier_waybill', ref).maybeSingle(),
    () =>
      supabase
        .from('manual_shipments')
        .select(MANUAL_SELECT)
        .eq('shipment_code', ref.toUpperCase())
        .maybeSingle(),
  ];

  for (const run of selectors) {
    const { data } = await run();
    if (data) return data;
  }

  return null;
}

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

  const readAccess = await assertStaffCanReadShipments(event);
  if (!readAccess.ok) {
    return { statusCode: readAccess.statusCode, headers, body: readAccess.body };
  }

  try {
    const rawUrl =
      event.rawUrl ||
      `http://localhost${event.path}${event.queryStringParameters ? `?${new URLSearchParams(event.queryStringParameters).toString()}` : ''}`;
    const url = new URL(rawUrl);
    const code = (url.searchParams.get('code') || '').trim();
    const hubId = url.searchParams.get('hubId');

    if (!code) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'code is required' }),
      };
    }

    let subOrder = null;
    let manualShipment = null;
    let hubMismatch = false;

    if (hubId) {
      const allHubIds = await hubIdsForDispatch(hubId);
      subOrder = await findSubOrder(code, allHubIds);
    }

    if (!subOrder) {
      manualShipment = await findManualShipment(code);
      if (manualShipment && hubId) {
        const allHubIds = await hubIdsForDispatch(hubId);
        const senderHub = manualShipment.sender_hub_id;
        hubMismatch = Boolean(senderHub && !allHubIds.includes(senderHub));
      }
    }

    if (!subOrder && !manualShipment) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, match: null }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        match: subOrder
          ? { type: 'sub_order', data: subOrder, hubMismatch: false }
          : { type: 'manual_shipment', data: manualShipment, hubMismatch },
      }),
    };
  } catch (error) {
    console.error('scan-waybill error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: error?.message || 'Failed to resolve scanned code',
      }),
    };
  }
}
