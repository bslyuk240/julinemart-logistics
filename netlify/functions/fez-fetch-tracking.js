// Fez Delivery - Fetch Tracking Function
// Supports sub_orders (subOrderId) and manual_shipments (shipmentId).

import { createClient } from '@supabase/supabase-js';
import { sendApiCourierStatusCustomerEmail } from '../../shared/riderAssignedEmail.js';
import { refreshOverallOrderStatus } from './helpers/orderStatusHelper.js';
import {
  fetchFezTracking,
  insertTrackingEvent,
  isValidFezTrackingNumber,
  mapFezStatus,
} from './services/fezTracking.js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

async function applySubOrderTracking(subOrderId, subOrder, trackingNumber, trackingData) {
  const previousStatus = subOrder.status;
  const jloStatus = mapFezStatus(trackingData.order.orderStatus);
  const fezLabel = trackingData.order?.orderStatus || '';
  const now = new Date().toISOString();

  await supabase
    .from('sub_orders')
    .update({ status: jloStatus, last_tracking_update: now })
    .eq('id', subOrderId);

  if (previousStatus !== jloStatus) {
    await insertTrackingEvent(supabase, {
      sub_order_id: subOrderId,
      status: jloStatus,
      description: fezLabel || `Status updated to ${jloStatus}`,
      event_time: now,
      source: 'api',
      source_reference: trackingNumber,
      metadata: { fez_status: fezLabel },
    });
  }

  if (previousStatus !== jloStatus && subOrder.main_order_id) {
    try {
      await refreshOverallOrderStatus(supabase, subOrder.main_order_id);
    } catch (e) {
      console.warn('refreshOverallOrderStatus (fez-fetch-tracking):', e?.message || e);
    }

    const { data: orderRow } = await supabase
      .from('orders')
      .select('id, order_number, customer_name, customer_email, delivery_city, delivery_state')
      .eq('id', subOrder.main_order_id)
      .maybeSingle();

    if (orderRow?.customer_email) {
      let courierDisplay = 'Fez Delivery';
      if (subOrder.courier_id) {
        const { data: cRow } = await supabase
          .from('couriers')
          .select('name')
          .eq('id', subOrder.courier_id)
          .maybeSingle();
        if (cRow?.name) courierDisplay = cRow.name;
      }
      const fezTrackUrl =
        subOrder.courier_tracking_url ||
        `https://web.fezdelivery.co/track-delivery?tracking=${encodeURIComponent(String(trackingNumber))}`;
      try {
        await sendApiCourierStatusCustomerEmail(supabase, {
          jloStatus,
          orderId: orderRow.id,
          orderNumber: orderRow.order_number ?? orderRow.id,
          customer_name: orderRow.customer_name,
          customer_email: orderRow.customer_email,
          tracking_number: trackingNumber,
          courier_tracking_url: fezTrackUrl,
          courier_display_name: courierDisplay,
          delivery_city: orderRow.delivery_city,
          delivery_state: orderRow.delivery_state,
          raw_status_hint: fezLabel,
        });
      } catch (mailErr) {
        console.error('sendApiCourierStatusCustomerEmail (fez-fetch-tracking):', mailErr?.message || mailErr);
      }
    }
  }

  return { jloStatus, fezLabel };
}

async function applyManualShipmentTracking(shipmentId, shipment, trackingNumber, trackingData) {
  const previousStatus = shipment.status;
  const jloStatus = mapFezStatus(trackingData.order.orderStatus);
  const fezLabel = trackingData.order?.orderStatus || '';
  const now = new Date().toISOString();

  await supabase
    .from('manual_shipments')
    .update({ status: jloStatus, last_tracking_update: now })
    .eq('id', shipmentId);

  if (previousStatus !== jloStatus) {
    await insertTrackingEvent(supabase, {
      manual_shipment_id: shipmentId,
      status: jloStatus,
      description: fezLabel || `Status updated to ${jloStatus}`,
      event_time: now,
      source: 'api',
      source_reference: trackingNumber,
      metadata: { fez_status: fezLabel },
    });
  }

  return { jloStatus, fezLabel };
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

  try {
    const subOrderId = event.queryStringParameters?.subOrderId;
    const shipmentId = event.queryStringParameters?.shipmentId;

    if (!subOrderId && !shipmentId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'subOrderId or shipmentId required' }),
      };
    }

    if (subOrderId) {
      const { data: subOrder, error } = await supabase
        .from('sub_orders')
        .select('*')
        .eq('id', subOrderId)
        .single();

      if (error || !subOrder) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ success: false, error: 'Sub-order not found' }),
        };
      }

      const trackingNumber = subOrder.courier_waybill || subOrder.tracking_number;
      if (!isValidFezTrackingNumber(trackingNumber)) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ success: false, error: 'No valid Fez tracking number' }),
        };
      }

      const trackingData = await fetchFezTracking(supabase, trackingNumber);
      const { jloStatus, fezLabel } = await applySubOrderTracking(
        subOrderId,
        subOrder,
        trackingNumber,
        trackingData,
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          data: {
            status: jloStatus,
            fez_status: fezLabel || trackingData.order.orderStatus,
            tracking_number: trackingNumber,
            history: trackingData.history,
            last_update: new Date().toISOString(),
          },
        }),
      };
    }

    const { data: shipment, error: shipErr } = await supabase
      .from('manual_shipments')
      .select('*')
      .eq('id', shipmentId)
      .single();

    if (shipErr || !shipment) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ success: false, error: 'Manual shipment not found' }),
      };
    }

    const trackingNumber = shipment.courier_waybill || shipment.tracking_number;
    if (!isValidFezTrackingNumber(trackingNumber)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'No valid Fez tracking number' }),
      };
    }

    const trackingData = await fetchFezTracking(supabase, trackingNumber);
    const { jloStatus, fezLabel } = await applyManualShipmentTracking(
      shipmentId,
      shipment,
      trackingNumber,
      trackingData,
    );

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        data: {
          status: jloStatus,
          fez_status: fezLabel || trackingData.order.orderStatus,
          tracking_number: trackingNumber,
          history: trackingData.history,
          last_update: new Date().toISOString(),
        },
      }),
    };
  } catch (err) {
    console.error('Fez tracking error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Failed to fetch tracking',
        message: err.message,
      }),
    };
  }
}
