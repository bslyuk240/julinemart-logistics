/**
 * Customer emails for delivery: local rider steps + API courier (Fez, etc.) status updates.
 * Uses email_config + SMTP (same path as order confirmation).
 */
import nodemailer from 'nodemailer';
import { decryptEmailConfigSecrets } from './emailSecretsCrypto.js';
import { buildCustomSmtpTransportOptions } from './smtpTransport.js';

async function logOrderEmail(supabase, { orderId, recipient, subject, status, errorMessage }) {
  try {
    await supabase.from('email_logs').insert({
      order_id: orderId || null,
      recipient,
      subject,
      status,
      error_message: errorMessage || null,
      sent_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('email_logs insert failed:', e?.message || e);
  }
}

const DEFAULT_CUSTOMER_PORTAL = 'https://jlo.julinemart.com/customer';

function customerTrackUrl() {
  return (
    (typeof process !== 'undefined' && process.env?.CUSTOMER_ORDER_PORTAL_URL?.replace(/\/+$/, '')) ||
    DEFAULT_CUSTOMER_PORTAL
  );
}

/**
 * @returns {Promise<{ transporter: import('nodemailer').Transporter; from: string } | { error: string }>}
 */
async function loadMailTransport(supabase) {
  const { data: rawCfg, error: cfgErr } = await supabase.from('email_config').select('*').limit(1).maybeSingle();
  if (cfgErr) console.error('[localDeliveryEmail] email_config:', cfgErr.message);
  const cfg = rawCfg ? decryptEmailConfigSecrets(rawCfg) : null;

  if (!cfg?.email_enabled) {
    return { error: 'Email notifications are turned off (email_enabled is false).' };
  }

  let transportConfig;
  let from;
  if (cfg.provider === 'gmail') {
    transportConfig = { service: 'gmail', auth: { user: cfg.gmail_user, pass: cfg.gmail_password } };
    from = cfg.email_from || cfg.gmail_user;
  } else if (cfg.provider === 'sendgrid') {
    transportConfig = { host: 'smtp.sendgrid.net', port: 587, auth: { user: 'apikey', pass: cfg.sendgrid_api_key } };
    from = cfg.email_from;
  } else {
    transportConfig = buildCustomSmtpTransportOptions(cfg);
    from = cfg.email_from || cfg.smtp_user;
  }

  if (!from) {
    return { error: 'From address is not configured in Email Settings.' };
  }

  return { transporter: nodemailer.createTransport(transportConfig), from };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function sendLocalRiderAssignedEmail(supabase, params) {
  const {
    orderId,
    orderNumber,
    customer_name,
    customer_email,
    tracking_number,
    rider_name,
    rider_phone,
    rider_vehicle,
    delivery_city,
    delivery_state,
  } = params;

  const to = (customer_email && String(customer_email).trim()) || '';
  const subject = `Order #${orderNumber} — Local rider assigned`;

  try {
    if (!to) {
      await logOrderEmail(supabase, {
        orderId,
        recipient: '(no customer email)',
        subject,
        status: 'failed',
        errorMessage: 'No customer_email on order; cannot send rider assignment email.',
      });
      return;
    }

    const mt = await loadMailTransport(supabase);
    if ('error' in mt) {
      await logOrderEmail(supabase, { orderId, recipient: to, subject, status: 'failed', errorMessage: mt.error });
      return;
    }

    const trackBase = customerTrackUrl();
    const area =
      [delivery_city, delivery_state].filter(Boolean).join(', ') || 'your delivery address';
    const vehicleLine = rider_vehicle
      ? `<p style="margin:8px 0 0;font-size:14px;color:#555">Vehicle: ${escapeHtml(rider_vehicle)}</p>`
      : '';

    const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
  <div style="background:#6b21a8;color:#fff;padding:28px;text-align:center">
    <h1 style="margin:0;font-size:22px">Your rider is assigned 🚚</h1>
    <p style="margin:10px 0 0;opacity:.9;font-size:15px">Order #${escapeHtml(String(orderNumber))}</p>
  </div>
  <div style="padding:28px;background:#fff;color:#333">
    <p style="margin:0 0 16px">Hi ${escapeHtml(customer_name || 'there')},</p>
    <p style="margin:0 0 16px;line-height:1.5">A local delivery rider has been assigned to your order. Use your <strong>tracking number</strong> with JulineMart if you need help from support.</p>
    <div style="padding:18px;background:#f3f4f6;border-radius:10px;margin:18px 0;border:1px solid #e5e7eb">
      <p style="margin:0 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#6b7280">Tracking number</p>
      <p style="margin:0;font-size:20px;font-weight:700;color:#6b21a8;word-break:break-all">${escapeHtml(String(tracking_number || '—'))}</p>
    </div>
    <div style="padding:16px;background:#fef9c3;border-radius:8px;margin-bottom:18px">
      <p style="margin:0;font-weight:bold">Rider</p>
      <p style="margin:6px 0 0;font-size:16px">${escapeHtml(rider_name)}</p>
      <p style="margin:6px 0 0"><a href="tel:${encodeTel(rider_phone)}" style="color:#6b21a8;font-weight:600">${escapeHtml(rider_phone)}</a></p>
      ${vehicleLine}
    </div>
    <p style="margin:0 0 8px;font-size:14px;color:#555"><strong>Delivery area:</strong> ${escapeHtml(area)}</p>
    <p style="margin:20px 0 0;font-size:14px;line-height:1.5">Track updates in your account: <a href="${trackBase}" style="color:#6b21a8">${trackBase.replace(/^https?:\/\//, '')}</a></p>
  </div>
  <div style="background:#f3f4f6;padding:14px;text-align:center;font-size:12px;color:#666">JulineMart</div>
</div>`;

    await mt.transporter.sendMail({ from: mt.from, to, subject, html });
    await logOrderEmail(supabase, { orderId, recipient: to, subject, status: 'sent' });
  } catch (err) {
    console.error('[riderAssignedEmail]', err?.message || err);
    await logOrderEmail(supabase, {
      orderId,
      recipient: to || customer_email || '',
      subject,
      status: 'failed',
      errorMessage: err?.message || String(err),
    });
  }
}

/**
 * @param {'out_for_delivery' | 'delivered'} params.phase
 */
export async function sendLocalDeliveryStatusEmail(supabase, params) {
  const {
    phase: phaseRaw,
    orderId,
    orderNumber,
    customer_name,
    customer_email,
    tracking_number,
    rider_name,
    rider_phone,
    delivery_city,
    delivery_state,
  } = params;

  const phase = String(phaseRaw || '').trim().toLowerCase();
  const to = (customer_email && String(customer_email).trim()) || '';
  const subject =
    phase === 'delivered'
      ? `JulineMart: Order #${orderNumber} delivered (local rider)`
      : `JulineMart: Order #${orderNumber} out for delivery (local rider)`;

  try {
    if (!to) {
      await logOrderEmail(supabase, {
        orderId,
        recipient: '(no customer email)',
        subject,
        status: 'failed',
        errorMessage: 'No customer_email on order.',
      });
      return;
    }

    const mt = await loadMailTransport(supabase);
    if ('error' in mt) {
      await logOrderEmail(supabase, { orderId, recipient: to, subject, status: 'failed', errorMessage: mt.error });
      return;
    }

    const trackBase = customerTrackUrl();
    const area =
      [delivery_city, delivery_state].filter(Boolean).join(', ') || 'your delivery address';
    const riderBlock =
      rider_name || rider_phone
        ? `<div style="padding:14px;background:#f9fafb;border-radius:8px;margin:16px 0;border:1px solid #e5e7eb">
      <p style="margin:0;font-size:12px;text-transform:uppercase;color:#6b7280">Your rider</p>
      <p style="margin:6px 0 0;font-size:15px">${escapeHtml(rider_name || '—')}</p>
      ${
        rider_phone
          ? `<p style="margin:6px 0 0"><a href="tel:${encodeTel(rider_phone)}" style="color:#6b21a8;font-weight:600">${escapeHtml(rider_phone)}</a></p>`
          : ''
      }
    </div>`
        : '';

    const headTitle = phase === 'delivered' ? 'Delivered' : 'Out for delivery';
    const headSub = phase === 'delivered' ? 'Your order has arrived' : 'Your order is on the way';
    const bodyLead =
      phase === 'delivered'
        ? `Your order has been marked <strong>delivered</strong>. We hope you enjoy your purchase!`
        : `Your package is <strong>out for delivery</strong> with our local rider.`;

    const textLines = [
      `Hi ${customer_name || 'there'},`,
      '',
      phase === 'delivered'
        ? 'Your JulineMart order has been marked delivered. Thank you for shopping with us.'
        : 'Your JulineMart package is out for delivery with your local rider.',
      '',
      `Order: #${orderNumber}`,
      `Tracking: ${tracking_number || '—'}`,
      rider_name ? `Rider: ${rider_name}` : '',
      rider_phone ? `Rider phone: ${rider_phone}` : '',
      `Area: ${area}`,
      '',
      `Track or view your order: ${trackBase}`,
      '',
      '— JulineMart',
    ].filter(Boolean);
    const text = textLines.join('\n');

    const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
  <div style="background:#6b21a8;color:#fff;padding:28px;text-align:center">
    <h1 style="margin:0;font-size:22px">${headTitle}</h1>
    <p style="margin:10px 0 0;opacity:.9;font-size:15px">Order #${escapeHtml(String(orderNumber))}</p>
    <p style="margin:8px 0 0;font-size:14px;opacity:.85">${headSub}</p>
  </div>
  <div style="padding:28px;background:#fff;color:#333">
    <p style="margin:0 0 16px">Hi ${escapeHtml(customer_name || 'there')},</p>
    <p style="margin:0 0 16px;line-height:1.55">${bodyLead}</p>
    <div style="padding:18px;background:#f3f4f6;border-radius:10px;margin:16px 0;border:1px solid #e5e7eb">
      <p style="margin:0 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#6b7280">Tracking number</p>
      <p style="margin:0;font-size:18px;font-weight:700;color:#6b21a8;word-break:break-all">${escapeHtml(String(tracking_number || '—'))}</p>
    </div>
    ${riderBlock}
    <p style="margin:12px 0 0;font-size:14px;color:#555"><strong>Area:</strong> ${escapeHtml(area)}</p>
    <p style="margin:22px 0 0;font-size:14px;line-height:1.5">View your order anytime: <a href="${trackBase}" style="color:#6b21a8">${trackBase.replace(/^https?:\/\//, '')}</a></p>
  </div>
  <div style="background:#f3f4f6;padding:14px;text-align:center;font-size:12px;color:#666">JulineMart</div>
</div>`;

    await mt.transporter.sendMail({
      from: mt.from,
      to,
      subject,
      text,
      html,
      headers: {
        'X-Entity-Ref-ID': orderId ? String(orderId) : 'local-delivery',
      },
    });
    await logOrderEmail(supabase, { orderId, recipient: to, subject, status: 'sent' });
  } catch (err) {
    console.error('[sendLocalDeliveryStatusEmail]', err?.message || err);
    await logOrderEmail(supabase, {
      orderId,
      recipient: to || customer_email || '',
      subject,
      status: 'failed',
      errorMessage: err?.message || String(err),
    });
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function encodeTel(phone) {
  return String(phone || '').replace(/[^\d+]/g, '');
}

/** Sub-order statuses we notify customers about for API / Fez couriers */
const API_COURIER_EMAILED_STATUSES = new Set([
  'assigned',
  'pending_pickup',
  'picked_up',
  'in_transit',
  'out_for_delivery',
  'delivered',
  'cancelled',
  'returned',
]);

const API_STATUS_SUBJECT = {
  assigned: 'Shipping booked — tracking ready',
  pending_pickup: 'Awaiting courier pickup',
  picked_up: 'Picked up by courier',
  in_transit: 'In transit',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  cancelled: 'Shipment update (cancelled)',
  returned: 'Shipment update (returned)',
};

const API_STATUS_HEADLINE = {
  assigned: 'Your shipment is booked',
  pending_pickup: 'Awaiting pickup',
  picked_up: 'Picked up',
  in_transit: 'On the way',
  out_for_delivery: 'Almost there',
  delivered: 'Delivered',
  cancelled: 'Shipment cancelled',
  returned: 'Return update',
};

/**
 * Customer email when an API courier (e.g. Fez) updates shipment status or tracking is created.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {object} p
 * @param {string} p.jloStatus — sub_orders.status value
 * @param {string} [p.orderId]
 * @param {string} p.orderNumber
 * @param {string} p.customer_name
 * @param {string} p.customer_email
 * @param {string} [p.tracking_number]
 * @param {string} [p.courier_tracking_url]
 * @param {string} [p.courier_display_name] — e.g. "Fez Delivery"
 * @param {string} [p.delivery_city]
 * @param {string} [p.delivery_state]
 * @param {string} [p.raw_status_hint] — provider’s label for the body
 */
export async function sendApiCourierStatusCustomerEmail(supabase, p) {
  const jlo = p.jloStatus;
  if (!jlo || !API_COURIER_EMAILED_STATUSES.has(jlo)) return;

  const to = (p.customer_email && String(p.customer_email).trim()) || '';
  const orderNum = String(p.orderNumber ?? '');
  const subjectSuffix = API_STATUS_SUBJECT[jlo] || 'Delivery update';
  const subject = `Order #${orderNum} — ${subjectSuffix}`;

  try {
    if (!to) {
      await logOrderEmail(supabase, {
        orderId: p.orderId,
        recipient: '(no customer email)',
        subject,
        status: 'failed',
        errorMessage: 'No customer_email on order.',
      });
      return;
    }

    const mt = await loadMailTransport(supabase);
    if ('error' in mt) {
      await logOrderEmail(supabase, { orderId: p.orderId, recipient: to, subject, status: 'failed', errorMessage: mt.error });
      return;
    }

    const trackBase = customerTrackUrl();
    const courierName = (p.courier_display_name && String(p.courier_display_name).trim()) || 'Your courier';
    const area =
      [p.delivery_city, p.delivery_state].filter(Boolean).join(', ') || 'your delivery address';
    const headline = API_STATUS_HEADLINE[jlo] || 'Delivery update';

    const trackingBlock =
      p.tracking_number && String(p.tracking_number).trim()
        ? `<div style="padding:18px;background:#f3f4f6;border-radius:10px;margin:16px 0;border:1px solid #e5e7eb">
      <p style="margin:0 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#6b7280">Tracking number</p>
      <p style="margin:0;font-size:18px;font-weight:700;color:#6b21a8;word-break:break-all">${escapeHtml(String(p.tracking_number))}</p>
    </div>`
        : '';

    const rawTrackUrl = p.courier_tracking_url && String(p.courier_tracking_url).trim();
    let safeTrackHref = '';
    if (rawTrackUrl && /^https?:\/\//i.test(rawTrackUrl)) {
      safeTrackHref = rawTrackUrl.replace(/"/g, '');
    }
    const courierTrackLink = safeTrackHref
      ? `<p style="margin:16px 0 0"><a href="${safeTrackHref}" style="display:inline-block;padding:12px 20px;background:#6b21a8;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">Track with ${escapeHtml(courierName)}</a></p>`
      : '';

    const hintLine = p.raw_status_hint
      ? `<p style="margin:12px 0 0;font-size:13px;color:#666">Courier status: ${escapeHtml(String(p.raw_status_hint))}</p>`
      : '';

    const bodyByStatus = {
      assigned: `Your order has been handed to <strong>${escapeHtml(courierName)}</strong>. Use the tracking number below or the link to follow your package.`,
      pending_pickup: `Your package is scheduled for pickup by <strong>${escapeHtml(courierName)}</strong>.`,
      picked_up: `<strong>${escapeHtml(courierName)}</strong> has collected your package.`,
      in_transit: `Your package is <strong>in transit</strong> with ${escapeHtml(courierName)}.`,
      out_for_delivery: `Your package is <strong>out for delivery</strong> with ${escapeHtml(courierName)}.`,
      delivered: `Your order has been <strong>delivered</strong>. We hope you enjoy your purchase!`,
      cancelled: `Your shipment with ${escapeHtml(courierName)} was <strong>cancelled</strong>. Contact JulineMart support if you need help.`,
      returned: `There is a <strong>return</strong> update on your shipment with ${escapeHtml(courierName)}. Check your order page for details.`,
    };

    const lead = bodyByStatus[jlo] || `Your delivery status was updated (${escapeHtml(jlo)}).`;

    const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
  <div style="background:#6b21a8;color:#fff;padding:28px;text-align:center">
    <h1 style="margin:0;font-size:22px">${headline}</h1>
    <p style="margin:10px 0 0;opacity:.9;font-size:15px">Order #${escapeHtml(orderNum)}</p>
    <p style="margin:8px 0 0;font-size:13px;opacity:.85">${escapeHtml(courierName)}</p>
  </div>
  <div style="padding:28px;background:#fff;color:#333">
    <p style="margin:0 0 16px">Hi ${escapeHtml(p.customer_name || 'there')},</p>
    <p style="margin:0 0 16px;line-height:1.55">${lead}</p>
    ${trackingBlock}
    ${courierTrackLink}
    ${hintLine}
    <p style="margin:20px 0 0;font-size:14px;color:#555"><strong>Delivery area:</strong> ${escapeHtml(area)}</p>
    <p style="margin:18px 0 0;font-size:14px;line-height:1.5">Your JulineMart order hub: <a href="${trackBase}" style="color:#6b21a8">${trackBase.replace(/^https?:\/\//, '')}</a></p>
  </div>
  <div style="background:#f3f4f6;padding:14px;text-align:center;font-size:12px;color:#666">JulineMart</div>
</div>`;

    await mt.transporter.sendMail({ from: mt.from, to, subject, html });
    await logOrderEmail(supabase, { orderId: p.orderId, recipient: to, subject, status: 'sent' });
  } catch (err) {
    console.error('[sendApiCourierStatusCustomerEmail]', err?.message || err);
    await logOrderEmail(supabase, {
      orderId: p.orderId,
      recipient: to || p.customer_email || '',
      subject,
      status: 'failed',
      errorMessage: err?.message || String(err),
    });
  }
}
