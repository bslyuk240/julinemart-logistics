import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || ''
);

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function isValidFezOrderNumber(value) {
  if (!value || typeof value !== 'string') return false;
  const bad = ['error', 'cannot', 'failed', 'invalid', 'wrong', 'something went wrong', 'already exists'];
  const lower = value.toLowerCase();
  if (bad.some((b) => lower.includes(b))) return false;
  return value.length < 50 && /^[A-Za-z0-9_-]+$/.test(value.trim());
}

function extractOrderCode(value) {
  if (!value || typeof value !== 'string') return null;
  const m = value.match(/order\s+([A-Za-z0-9_-]+)/i);
  return m && isValidFezOrderNumber(m[1]) ? m[1] : null;
}

async function authenticateFez() {
  const isProduction =
    process.env.CONTEXT === 'production' ||
    process.env.NETLIFY_CONTEXT === 'production' ||
    process.env.NODE_ENV === 'production';
  const environment = isProduction ? 'production' : 'sandbox';

  const { data: courier } = await supabase
    .from('couriers')
    .select('api_user_id, api_password, api_base_url')
    .eq('code', 'fez')
    .eq('api_enabled', true)
    .eq('environment', environment)
    .single();

  const userId = courier?.api_user_id || process.env.FEZ_USER_ID;
  const apiKey = courier?.api_password || process.env.FEZ_PASSWORD || process.env.FEZ_API_KEY;
  const baseUrl = courier?.api_base_url || process.env.FEZ_API_BASE_URL;

  if (!userId || !apiKey || !baseUrl) {
    throw new Error(`Missing Fez API credentials for ${environment}`);
  }

  const res = await fetch(`${baseUrl}/user/authenticate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, password: apiKey }),
  });
  const data = await res.json();
  if (data.status !== 'Success') throw new Error(data.description || 'Fez auth failed');

  return {
    authToken: data.authDetails.authToken,
    secretKey: data.orgDetails['secret-key'],
    baseUrl,
  };
}

async function callFezApi(authToken, secretKey, baseUrl, shipmentData) {
  const res = await fetch(`${baseUrl}/order`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
      'secret-key': secretKey,
    },
    body: JSON.stringify([shipmentData]),
  });
  const data = await res.json();
  console.log('FEZ BATCH ORDER RESPONSE:', JSON.stringify(data));

  if (data.status === 'Success' && data.orderNos) {
    const trackingId = Object.keys(data.orderNos)[0];
    const orderId = Object.values(data.orderNos)[0];
    if (isValidFezOrderNumber(orderId)) return { orderId, trackingId };
    const extracted = extractOrderCode(orderId);
    if (extracted) return { orderId: extracted, trackingId };
    throw new Error(orderId || 'Fez returned invalid order number');
  }

  if (data.orderNos && Object.keys(data.orderNos).length > 0) {
    const trackingId = Object.keys(data.orderNos)[0];
    const orderId = Object.values(data.orderNos)[0];
    if (isValidFezOrderNumber(orderId)) return { orderId, trackingId };
    const extracted = extractOrderCode(orderId);
    if (extracted) return { orderId: extracted, trackingId };
    throw new Error(orderId || data.description || 'Fez order creation failed');
  }

  throw new Error(data.description || data.message || 'Fez order creation failed');
}

function calcWeight(items) {
  if (!Array.isArray(items)) return 0;
  return items.reduce((s, i) => s + Number(i.weight || 0) * Number(i.quantity || 1), 0);
}

function calcValue(items) {
  if (!Array.isArray(items)) return 0;
  return items.reduce((s, i) => s + Number(i.price || 0) * Number(i.quantity || 1), 0);
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
  }

  try {
    const { hubId, subOrderIds, force = false } = JSON.parse(event.body || '{}');

    if (!hubId || !Array.isArray(subOrderIds) || subOrderIds.length === 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'hubId and non-empty subOrderIds[] are required' }),
      };
    }

    const uniqueIds = [...new Set(subOrderIds.filter(Boolean))];

    // Fetch full sub-order data needed for consolidation
    const { data: rows, error: fetchErr } = await supabase
      .from('sub_orders')
      .select(`
        id, hub_id, main_order_id, metadata, items, subtotal, tracking_number, courier_shipment_id,
        hubs (
          id, name, address, city, state,
          is_sub_hub, parent_hub_id,
          parent_hub:hubs!parent_hub_id (name, address, city, state)
        ),
        orders:main_order_id (
          id, order_number, overall_status,
          customer_name, customer_email, customer_phone,
          delivery_address, delivery_city, delivery_state
        )
      `)
      .in('id', uniqueIds);

    if (fetchErr) throw fetchErr;

    const byId = new Map((rows || []).map((r) => [r.id, r]));
    const successes = [];
    const failures = [];
    const skipped = [];

    // ── Validate and partition ────────────────────────────────────────────────
    // Only process Fez-lane sub-orders belonging to the requested hub (or its sub-hubs)
    const fezRows = [];
    for (const subOrderId of uniqueIds) {
      const row = byId.get(subOrderId);
      if (!row) { skipped.push({ subOrderId, reason: 'not_found' }); continue; }

      // Accept both the hub itself and any sub-hubs that route through it
      const effectiveHubId = row.hubs?.is_sub_hub && row.hubs?.parent_hub_id
        ? row.hubs.parent_hub_id
        : row.hub_id;
      if (effectiveHubId !== hubId && row.hub_id !== hubId) {
        skipped.push({ subOrderId, reason: 'hub_mismatch' }); continue;
      }

      const lane = row.metadata?.selected_lane || 'fez';
      if (lane !== 'fez') {
        skipped.push({ subOrderId, reason: 'lane_not_fez', selected_lane: lane }); continue;
      }

      if (!force && row.courier_shipment_id && isValidFezOrderNumber(row.tracking_number)) {
        skipped.push({ subOrderId, reason: 'already_dispatched', tracking: row.tracking_number }); continue;
      }

      fezRows.push(row);
    }

    if (fezRows.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true, hubId, force: Boolean(force),
          counts: { requested: uniqueIds.length, successes: 0, failures: 0, skipped: skipped.length },
          successes, failures, skipped,
        }),
      };
    }

    // ── Group by (main_order_id + effective_hub_id) ───────────────────────────
    // Sub-orders from the same order at the same effective dispatch hub = 1 Fez shipment
    const groups = new Map();
    for (const row of fezRows) {
      const effectiveHubId = row.hubs?.is_sub_hub && row.hubs?.parent_hub_id
        ? row.hubs.parent_hub_id
        : row.hub_id;
      const key = `${row.main_order_id}::${effectiveHubId}`;
      if (!groups.has(key)) {
        const dispatchHub = row.hubs?.is_sub_hub && row.hubs?.parent_hub
          ? row.hubs.parent_hub
          : row.hubs;
        groups.set(key, {
          key,
          mainOrderId: row.main_order_id,
          effectiveHubId,
          dispatchHub,
          order: row.orders,
          subOrders: [],
        });
      }
      groups.get(key).subOrders.push(row);
    }

    // ── Authenticate with Fez once ────────────────────────────────────────────
    const { authToken, secretKey, baseUrl } = await authenticateFez();

    // ── Dispatch one Fez shipment per group ───────────────────────────────────
    for (const group of groups.values()) {
      const { dispatchHub, order, subOrders: groupRows } = group;

      // Combine items, weight, and value across all sub-orders in the group
      const allItems = groupRows.flatMap((r) => (Array.isArray(r.items) ? r.items : []));
      const totalWeight = Math.max(1, Math.round(calcWeight(allItems)));
      const totalValue = calcValue(allItems);
      const shippingValue = Math.round(totalValue + 1000);

      const itemDesc = allItems.map((i) => `${i.quantity}x ${i.name}`).join(', ') || 'Package';

      // Use the first sub-order id as the unique anchor for this group
      const leadId = groupRows[0].id;
      const ts = Date.now().toString(36).toUpperCase();
      const uniqueID = `JLO-${leadId.slice(-8).toUpperCase()}-${ts}`;

      const shipmentData = {
        recipientAddress: order?.delivery_address || '',
        recipientState: order?.delivery_state || '',
        recipientName: order?.customer_name || '',
        recipientPhone: order?.customer_phone || '',
        recipientEmail: order?.customer_email || '',
        uniqueID,
        BatchID: String(order?.order_number || order?.id || leadId),
        itemDescription: itemDesc,
        valueOfItem: String(shippingValue),
        weight: totalWeight,
        pickUpAddress: dispatchHub?.address || '',
        pickUpState: dispatchHub?.state || '',
        additionalDetails: `Hub: ${dispatchHub?.name || 'JulineMart'}, ${dispatchHub?.city || ''}`,
      };

      console.log(`[batch] Group ${group.key} — ${groupRows.length} sub-orders, weight ${totalWeight}kg`);

      let orderId, trackingId;
      let lastErr;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const res = await callFezApi(authToken, secretKey, baseUrl, shipmentData);
          orderId = res.orderId;
          trackingId = res.trackingId;
          break;
        } catch (err) {
          lastErr = err;
          if (attempt < 2) await new Promise((r) => setTimeout(r, 1000));
        }
      }

      if (!orderId) {
        for (const row of groupRows) {
          failures.push({ subOrderId: row.id, error: lastErr?.message || 'Fez API failed' });
        }
        continue;
      }

      const trackingUrl = `https://web.fezdelivery.co/track-delivery?tracking=${orderId}`;

      // Write the same tracking number to ALL sub-orders in this group
      const { error: updateErr } = await supabase
        .from('sub_orders')
        .update({
          tracking_number: orderId,
          courier_shipment_id: trackingId,
          courier_waybill: orderId,
          courier_tracking_url: trackingUrl,
          status: 'assigned',
        })
        .in('id', groupRows.map((r) => r.id));

      if (updateErr) {
        console.error('[batch] update error:', updateErr);
        for (const row of groupRows) {
          failures.push({ subOrderId: row.id, error: updateErr.message });
        }
        continue;
      }

      // Promote parent order status if still pending
      if (order?.id && order?.overall_status === 'pending') {
        await supabase.from('orders').update({ overall_status: 'processing' }).eq('id', order.id);
      }

      // Activity log for the group
      await supabase.from('activity_logs').insert({
        user_id: null,
        action: 'courier_shipment_created',
        resource_type: 'sub_order_group',
        resource_id: leadId,
        details: {
          courier: 'fez',
          order_id: orderId,
          tracking_id: trackingId,
          group_key: group.key,
          sub_order_count: groupRows.length,
          combined_weight_kg: totalWeight,
          forced_resend: Boolean(force),
        },
      });

      for (const row of groupRows) {
        successes.push({ subOrderId: row.id, tracking_number: orderId, courier_shipment_id: trackingId });
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        hubId,
        force: Boolean(force),
        counts: {
          requested: uniqueIds.length,
          successes: successes.length,
          failures: failures.length,
          skipped: skipped.length,
        },
        successes,
        failures,
        skipped,
      }),
    };
  } catch (error) {
    console.error('fez-create-shipment-batch error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: error?.message || 'Failed to dispatch Fez batch' }),
    };
  }
}
