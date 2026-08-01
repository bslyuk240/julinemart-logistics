/**
 * Customer emails for manual shipments (optional recipient email).
 */
import {
  sendApiCourierStatusCustomerEmail,
  sendLocalRiderAssignedEmail,
} from '../../../shared/riderAssignedEmail.js';

export function manualShipmentPortalUrl(shipment) {
  const base = (
    process.env.CUSTOMER_ORDER_PORTAL_URL ||
    'https://jlo.julinemart.com/customer'
  ).replace(/\/+$/, '');
  const tracking = shipment.tracking_number || shipment.shipment_code || '';
  const phone = shipment.recipient?.phone || '';
  const qs = new URLSearchParams({
    tracking,
    phone,
  });
  return `${base}/track/shipment?${qs}`;
}

async function resolveCourierName(supabase, shipment, override) {
  if (override) return override;
  if (!shipment.courier_id) return 'Fez Delivery';
  const { data: cRow } = await supabase
    .from('couriers')
    .select('name')
    .eq('id', shipment.courier_id)
    .maybeSingle();
  return cRow?.name || 'Fez Delivery';
}

export async function notifyManualShipmentCourierStatus(supabase, shipment, opts = {}) {
  const email = shipment.recipient?.email?.trim();
  if (!email) return;

  const jloStatus = opts.jloStatus;
  if (!jloStatus) return;

  const courierDisplay = await resolveCourierName(supabase, shipment, opts.courier_display_name);
  const trackingNumber = opts.tracking_number || shipment.tracking_number;
  const trackUrl =
    opts.courier_tracking_url ||
    shipment.courier_tracking_url ||
    (trackingNumber
      ? `https://web.fezdelivery.co/track-delivery?tracking=${encodeURIComponent(String(trackingNumber))}`
      : null);

  try {
    await sendApiCourierStatusCustomerEmail(supabase, {
      jloStatus,
      customer_name: shipment.recipient?.name,
      customer_email: email,
      orderNumber: shipment.shipment_code,
      shipmentCode: shipment.shipment_code,
      tracking_number: trackingNumber,
      courier_tracking_url: trackUrl,
      courier_display_name: courierDisplay,
      delivery_city: shipment.recipient?.city,
      delivery_state: shipment.recipient?.state,
      raw_status_hint: opts.raw_status_hint,
      portalUrl: manualShipmentPortalUrl(shipment),
      suppressMissingEmailLog: true,
    });
  } catch (err) {
    console.error('notifyManualShipmentCourierStatus:', err?.message || err);
  }
}

export async function notifyManualShipmentRiderAssigned(supabase, shipment, rider) {
  const email = shipment.recipient?.email?.trim();
  if (!email) return;

  try {
    await sendLocalRiderAssignedEmail(supabase, {
      customer_name: shipment.recipient?.name,
      customer_email: email,
      orderNumber: shipment.shipment_code,
      shipmentCode: shipment.shipment_code,
      tracking_number: shipment.tracking_number,
      rider_name: rider.rider_name,
      rider_phone: rider.rider_phone,
      rider_vehicle: rider.rider_vehicle,
      delivery_city: shipment.recipient?.city,
      delivery_state: shipment.recipient?.state,
      portalUrl: manualShipmentPortalUrl(shipment),
      suppressMissingEmailLog: true,
    });
  } catch (err) {
    console.error('notifyManualShipmentRiderAssigned:', err?.message || err);
  }
}
