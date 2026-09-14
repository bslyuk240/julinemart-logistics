// Netlify Function: /api/resend-vendor-shipment-email
//
// Re-sends the vendor "shipment created — print your label/waybill" email
// using the sub-order's EXISTING tracking data. Deliberately does not touch
// Fez at all — unlike fez-create-shipment.js's `force` resend, which calls
// Fez's /order API again and would create a second, duplicate physical
// shipment. Use this when the email itself failed or was skipped (e.g. a
// misconfigured print-token secret at the moment the shipment was created)
// but the shipment on Fez is already real and correct.

import { createClient } from '@supabase/supabase-js';
import { sendVendorShipmentReadyEmail } from '../../shared/vendorFulfillment.js';
import { sendTransactionalEmail } from './services/emailNotifications.js';
import { assertStaffCanCreateShipment } from './services/shipmentAccess.js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
  }

  const access = await assertStaffCanCreateShipment(event);
  if (!access.ok) {
    return { statusCode: access.statusCode, headers, body: access.body };
  }

  let subOrderId;
  try {
    ({ subOrderId } = JSON.parse(event.body || '{}'));
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Invalid JSON' }) };
  }
  if (!subOrderId) {
    return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'subOrderId is required' }) };
  }

  const { data: subOrder, error } = await supabase
    .from('sub_orders')
    .select(`
      id, tracking_number, courier_shipment_id, courier_tracking_url,
      orders ( id, order_number ),
      vendors (
        id, email, store_name, hub_id, fez_collection_method, address, city, state,
        approved_location_id,
        approved_vendor_locations (
          fez_hub_name, fez_hub_address,
          courier_hubs ( name, address, city, state, phone ),
          hubs ( name, address, city )
        )
      )
    `)
    .eq('id', subOrderId)
    .single();

  if (error || !subOrder) {
    return { statusCode: 404, headers, body: JSON.stringify({ success: false, error: 'Sub-order not found' }) };
  }

  if (!subOrder.tracking_number) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ success: false, error: 'This shipment has not been dispatched yet — create it first.' }),
    };
  }

  if (!subOrder.vendors?.email) {
    return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Vendor has no email on file' }) };
  }

  await sendVendorShipmentReadyEmail(supabase, sendTransactionalEmail, {
    vendor: subOrder.vendors,
    orderId: subOrder.orders?.id,
    orderNumber: subOrder.orders?.order_number ?? subOrder.orders?.id,
    subOrderId: subOrder.id,
    trackingNumber: subOrder.tracking_number,
    trackingUrl: subOrder.courier_tracking_url,
  });

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ success: true, message: `Shipment email re-sent to ${subOrder.vendors.email}` }),
  };
}
