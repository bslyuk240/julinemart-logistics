// Manual Shipment - Fez Dispatch
// Normal direction (pickup = sender, recipient = recipient), unlike
// create-return-shipment.js's reversed pickup. Structurally mirrors that
// file's auth -> build payload -> retry -> persist shape, since a manual
// shipment is a single flat row like a return shipment, not a multi-item
// hub-split order like fez-create-shipment.js handles.

import { createClient } from '@supabase/supabase-js';
import { authenticateFez } from './services/fezAuth.js';
import { assertStaffCanCreateShipment } from './services/shipmentAccess.js';
import { notifyManualShipmentCourierStatus } from './services/manualShipmentNotify.js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

function generateShortUniqueId(baseId) {
  const shortId = (baseId || 'MSH').slice(-8);
  const timestamp = Date.now().toString(36);
  return `JLO-${shortId}-${timestamp}`.toUpperCase();
}

function isValidFezOrderNumber(value) {
  if (!value || typeof value !== 'string') return false;
  const bad = ['error', 'cannot', 'failed', 'invalid', 'wrong', 'something went wrong', 'already exists'];
  const low = value.toLowerCase();
  if (bad.some((b) => low.includes(b))) return false;
  return value.length < 50 && /^[A-Za-z0-9_-]+$/.test(value.trim());
}

async function createFezShipment(auth, payload) {
  const res = await fetch(`${auth.baseUrl}/order`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${auth.authToken}`,
      'secret-key': auth.secretKey,
    },
    body: JSON.stringify([payload]),
  });
  const data = await res.json();

  if (data.status === 'Success' && data.orderNos) {
    const trackingId = Object.keys(data.orderNos)[0];
    const orderId = Object.values(data.orderNos)[0];
    if (isValidFezOrderNumber(orderId)) return { trackingId, orderId, raw: data };
    const match = orderId?.match?.(/order\s+([A-Za-z0-9_-]+)/i);
    if (match && isValidFezOrderNumber(match[1])) return { trackingId, orderId: match[1], raw: data };
    const invalidErr = new Error(orderId || 'Fez returned invalid order number');
    invalidErr.raw = data;
    throw invalidErr;
  }

  const failErr = new Error(data.description || data.message || 'Failed to create Fez order');
  failErr.raw = data;
  throw failErr;
}

async function createFezShipmentWithRetry(auth, payload) {
  let lastErr;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      if (attempt > 1) await new Promise((r) => setTimeout(r, 1000));
      return await createFezShipment(auth, payload);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
  }

  try {
    const access = await assertStaffCanCreateShipment(event);
    if (!access.ok) {
      return { statusCode: access.statusCode, headers, body: access.body };
    }

    const { shipment_id } = JSON.parse(event.body || '{}');
    if (!shipment_id) {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'shipment_id is required' }) };
    }

    const { data: shipment, error: fetchError } = await supabase
      .from('manual_shipments')
      .select('*')
      .eq('id', shipment_id)
      .single();

    if (fetchError || !shipment) {
      return { statusCode: 404, headers, body: JSON.stringify({ success: false, error: 'Manual shipment not found' }) };
    }

    if (isValidFezOrderNumber(shipment.tracking_number)) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          data: {
            tracking_number: shipment.tracking_number,
            courier_shipment_id: shipment.courier_shipment_id,
            waybill_number: shipment.waybill_number,
          },
        }),
      };
    }

    const sender = shipment.sender || {};
    const recipient = shipment.recipient || {};

    const fezPayload = {
      recipientAddress: recipient.address || '',
      recipientState: recipient.state || 'Lagos',
      recipientName: recipient.name || 'Recipient',
      recipientPhone: recipient.phone || '',
      recipientEmail: (recipient.email && String(recipient.email).trim()) || '',
      pickUpAddress: sender.address || '',
      pickUpState: sender.state || 'Lagos',
      uniqueID: generateShortUniqueId(shipment_id),
      BatchID: shipment.shipment_code,
      itemDescription: shipment.item_description || 'Package',
      valueOfItem: String(shipment.item_value || 0),
      weight: Math.max(1, Math.round(Number(shipment.item_weight) || 1)),
      additionalDetails: `Manual shipment: ${shipment.shipment_code}`,
    };

    const auth = await authenticateFez(supabase);

    let fezTracking = null;
    let fezShipmentId = null;
    let rawPayload = null;

    try {
      const result = await createFezShipmentWithRetry(auth, fezPayload);
      fezTracking = result.orderId;
      fezShipmentId = result.trackingId;
      rawPayload = result.raw ?? null;
    } catch (err) {
      rawPayload = err.raw ?? { error: err.message };
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ success: false, error: 'Fez shipment creation failed', message: err.message, raw: rawPayload }),
      };
    }

    const trackingUrl = `https://web.fezdelivery.co/track-delivery?tracking=${fezTracking}`;

    let waybillNumber = shipment.waybill_number || null;
    if (!waybillNumber) {
      const { data: nextNumber, error: wbError } = await supabase.rpc('next_waybill_number');
      if (wbError) {
        console.error('waybill number generation failed:', wbError);
      } else {
        waybillNumber = nextNumber;
      }
    }

    const existingMetadata =
      shipment.metadata && typeof shipment.metadata === 'object' && !Array.isArray(shipment.metadata)
        ? shipment.metadata
        : {};

    const { data: updated, error: updateError } = await supabase
      .from('manual_shipments')
      .update({
        tracking_number: fezTracking,
        courier_shipment_id: fezShipmentId,
        courier_waybill: fezTracking,
        courier_tracking_url: trackingUrl,
        status: 'assigned',
        raw_payload: rawPayload,
        ...(waybillNumber ? { waybill_number: waybillNumber } : {}),
        metadata: { ...existingMetadata, selected_lane: 'fez', eligible_lanes: ['fez', 'local_rider'] },
      })
      .eq('id', shipment_id)
      .select()
      .single();

    if (updateError) {
      console.error('Manual shipment update error:', updateError);
      return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: updateError.message }) };
    }

    try {
      await supabase.from('activity_logs').insert({
        user_id: null,
        action: 'manual_shipment_dispatched',
        resource_type: 'manual_shipment',
        resource_id: shipment_id,
        details: { courier: 'fez', shipment_code: shipment.shipment_code, tracking_number: fezTracking },
      });
    } catch (logErr) {
      console.warn('Activity log failed:', logErr);
    }

    try {
      await notifyManualShipmentCourierStatus(supabase, { ...shipment, ...updated }, {
        jloStatus: 'assigned',
        tracking_number: fezTracking,
        courier_tracking_url: trackingUrl,
        raw_status_hint: 'Shipping booked',
      });
    } catch (mailErr) {
      console.error('manual shipment dispatch email:', mailErr?.message || mailErr);
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: updated }) };
  } catch (error) {
    console.error('manual-shipment-fez-dispatch error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: 'Internal server error', message: error?.message }),
    };
  }
};
