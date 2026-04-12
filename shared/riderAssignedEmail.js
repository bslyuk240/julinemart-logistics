/**
 * Email when a local rider is assigned to a sub-order (assign-rider Netlify function).
 * Uses the same email_config + SMTP path as order confirmation.
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

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {object} params
 * @param {string} [params.orderId]
 * @param {string} params.orderNumber
 * @param {string} params.customer_name
 * @param {string} params.customer_email
 * @param {string} params.tracking_number
 * @param {string} params.rider_name
 * @param {string} params.rider_phone
 * @param {string} [params.rider_vehicle]
 * @param {string} [params.delivery_city]
 * @param {string} [params.delivery_state]
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

    const { data: rawCfg, error: cfgErr } = await supabase.from('email_config').select('*').limit(1).maybeSingle();
    if (cfgErr) console.error('[riderAssignedEmail] email_config:', cfgErr.message);
    const cfg = rawCfg ? decryptEmailConfigSecrets(rawCfg) : null;

    if (!cfg?.email_enabled) {
      await logOrderEmail(supabase, {
        orderId,
        recipient: to,
        subject,
        status: 'failed',
        errorMessage: 'Email notifications are turned off (email_enabled is false).',
      });
      return;
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
      await logOrderEmail(supabase, {
        orderId,
        recipient: to,
        subject,
        status: 'failed',
        errorMessage: 'From address is not configured in Email Settings.',
      });
      return;
    }

    const trackBase =
      (typeof process !== 'undefined' && process.env?.CUSTOMER_ORDER_PORTAL_URL?.replace(/\/+$/, '')) ||
      DEFAULT_CUSTOMER_PORTAL;

    const area =
      [delivery_city, delivery_state].filter(Boolean).join(', ') || 'your delivery address';

    const vehicleLine = rider_vehicle ? `<p style="margin:8px 0 0;font-size:14px;color:#555">Vehicle: ${escapeHtml(rider_vehicle)}</p>` : '';

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

    const transporter = nodemailer.createTransport(transportConfig);
    await transporter.sendMail({ from, to, subject, html });
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
