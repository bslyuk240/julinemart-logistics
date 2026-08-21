/**
 * Customer emails for manual shipments (optional recipient email).
 */
import {
  sendApiCourierStatusCustomerEmail,
  sendLocalRiderAssignedEmail,
  sendLocalDeliveryStatusEmail,
  loadMailTransport,
  logOrderEmail,
  escapeHtml,
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

/**
 * Delivery-status-progress emails for a manual shipment fulfilled by a
 * LOCAL RIDER (picked_up/out_for_delivery/delivered/failed/returning/
 * returned) — the local-rider-flavored template (mentions the rider by
 * name/phone), not the Fez/API-courier one notifyManualShipmentCourierStatus
 * sends. rider-jobs.js's advance/fail_delivery/start_return/confirm_returned
 * actions call this for manual shipments the same way they already call
 * notifyCustomer for sub_orders.
 */
export async function notifyManualShipmentLocalRiderStatus(supabase, shipment, opts = {}) {
  const email = shipment.recipient?.email?.trim();
  if (!email) return;

  const phase = opts.phase;
  if (!phase) return;

  try {
    await sendLocalDeliveryStatusEmail(supabase, {
      phase,
      orderNumber: shipment.shipment_code,
      customer_name: shipment.recipient?.name,
      customer_email: email,
      tracking_number: opts.tracking_number || shipment.tracking_number,
      rider_name: opts.rider_name,
      rider_phone: opts.rider_phone,
      delivery_city: shipment.recipient?.city,
      delivery_state: shipment.recipient?.state,
      delivery_proof_url: opts.delivery_proof_url,
    });
  } catch (err) {
    console.error('notifyManualShipmentLocalRiderStatus:', err?.message || err);
  }
}

/**
 * One-time "your package was picked up" confirmation to the sender —
 * mirrors the pickup-confirmation-only decision made for vendors on
 * catalog orders (see sendVendorPickupConfirmationEmail in
 * orderConfirmationEmail.js). Senders are institutional (JLO hub or a
 * vendor) right now, not individuals, so sender.email is optional and this
 * is a no-op whenever it's not set.
 */
export async function notifyManualShipmentSenderPickedUp(supabase, shipment, rider) {
  const email = shipment.sender?.email?.trim();
  if (!email) return;

  const subject = `JulineMart: Package ${shipment.shipment_code || ''} picked up`;
  try {
    const mt = await loadMailTransport(supabase);
    if ('error' in mt) {
      await logOrderEmail(supabase, { recipient: email, subject, status: 'failed', errorMessage: mt.error });
      return;
    }

    const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
  <div style="background:#6b21a8;color:#fff;padding:28px;text-align:center">
    <h1 style="margin:0;font-size:22px">Picked up</h1>
    <p style="margin:8px 0 0;opacity:.85">Package ${escapeHtml(shipment.shipment_code || '')}</p>
  </div>
  <div style="padding:28px;background:#fff;color:#333">
    <p style="margin:0 0 16px">Hi ${escapeHtml(shipment.sender?.name || 'there')},</p>
    <p style="margin:0 0 16px;line-height:1.55">Our rider has collected the package for <strong>${escapeHtml(shipment.recipient?.name || 'the recipient')}</strong> and is on the way.</p>
    ${
      rider?.rider_name
        ? `<div style="padding:14px;background:#f9fafb;border-radius:8px;margin:16px 0;border:1px solid #e5e7eb">
      <p style="margin:0;font-size:12px;text-transform:uppercase;color:#6b7280">Rider</p>
      <p style="margin:6px 0 0;font-size:15px">${escapeHtml(rider.rider_name)}</p>
      ${rider.rider_phone ? `<p style="margin:6px 0 0">${escapeHtml(rider.rider_phone)}</p>` : ''}
    </div>`
        : ''
    }
    <p style="margin:0;font-size:14px;color:#555">Tracking: ${escapeHtml(shipment.tracking_number || '—')}</p>
  </div>
  <div style="background:#f3f4f6;padding:14px;text-align:center;font-size:12px;color:#666">JulineMart</div>
</div>`;

    const text = `Hi ${shipment.sender?.name || 'there'},\n\nOur rider has collected the package for ${shipment.recipient?.name || 'the recipient'} and is on the way.\n\nTracking: ${shipment.tracking_number || '—'}\n\n— JulineMart`;

    await mt.transporter.sendMail({ from: mt.from, to: email, subject, html, text });
    await logOrderEmail(supabase, { recipient: email, subject, status: 'sent' });
  } catch (err) {
    console.error('notifyManualShipmentSenderPickedUp:', err?.message || err);
    await logOrderEmail(supabase, { recipient: email, subject, status: 'failed', errorMessage: err?.message || String(err) });
  }
}
