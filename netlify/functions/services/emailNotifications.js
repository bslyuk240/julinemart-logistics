/**
 * Shared transactional email utility for Netlify functions.
 *
 * Usage:
 *   import { sendTransactionalEmail } from './services/emailNotifications.js';
 *
 *   await sendTransactionalEmail({
 *     templateName: 'Order Confirmation',
 *     to: 'customer@example.com',
 *     data: { orderNumber: '1014', customerName: 'Jane', totalAmount: '5,000', ... },
 *     orderId: 'uuid',   // optional — used for dedup + audit log
 *   });
 *
 * - Never throws. All failures are logged to email_logs and swallowed.
 * - Deduplicates: won't re-send the same template to the same order within 10 min.
 * - Config is read from the email_config table (DB takes precedence) then env vars.
 */

import nodemailer from 'nodemailer';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || ''
);

// ── Transport helpers ─────────────────────────────────────────────────────────

function buildEnvTransport() {
  const provider = (process.env.EMAIL_PROVIDER || 'gmail').toLowerCase();
  if (provider === 'sendgrid') {
    return {
      host: 'smtp.sendgrid.net',
      port: 587,
      auth: { user: 'apikey', pass: process.env.SENDGRID_API_KEY },
    };
  }
  if (provider === 'smtp') {
    return {
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
    };
  }
  // gmail default
  return {
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASSWORD },
  };
}

/**
 * Returns { transport, from } or null if email is disabled / not configured.
 */
async function getTransport() {
  try {
    const { data: cfg } = await supabase.from('email_config').select('*').single();

    if (cfg) {
      if (cfg.email_enabled === false) return null; // admin disabled emails

      let transportConfig;
      switch (cfg.provider) {
        case 'gmail':
          transportConfig = {
            service: 'gmail',
            auth: { user: cfg.gmail_user, pass: cfg.gmail_password },
          };
          break;
        case 'sendgrid':
          transportConfig = {
            host: 'smtp.sendgrid.net',
            port: 587,
            auth: { user: 'apikey', pass: cfg.sendgrid_api_key },
          };
          break;
        case 'smtp':
          transportConfig = {
            host: cfg.smtp_host,
            port: cfg.smtp_port || 587,
            secure: cfg.smtp_port === 465,
            auth: { user: cfg.smtp_user, pass: cfg.smtp_password },
          };
          break;
        default:
          transportConfig = buildEnvTransport();
      }

      const from =
        cfg.email_from ||
        cfg.gmail_user ||
        cfg.smtp_user ||
        process.env.EMAIL_FROM ||
        process.env.EMAIL_USER ||
        '';

      return { transport: nodemailer.createTransport(transportConfig), from };
    }
  } catch (_e) {
    // DB unavailable — fall through to env
  }

  // Env-var fallback
  if (process.env.EMAIL_ENABLED === 'false') return null;

  const from = process.env.EMAIL_FROM || process.env.EMAIL_USER || '';
  if (!from) return null; // nothing configured at all

  return { transport: nodemailer.createTransport(buildEnvTransport()), from };
}

// ── Template rendering ────────────────────────────────────────────────────────

function render(template, data) {
  let out = template || '';
  for (const [key, val] of Object.entries(data || {})) {
    const safe = val == null ? '' : String(val);
    out = out.replace(new RegExp(`{{${key}}}`, 'g'), safe);
  }
  return out;
}

// ── Audit logging ─────────────────────────────────────────────────────────────

async function logEmail({ orderId, recipient, subject, status, errorMessage }) {
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
    console.error('[emailNotifications] Failed to write email_log:', e?.message);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Send a transactional email using a named DB template.
 *
 * @param {object} opts
 * @param {string}  opts.templateName  — must match email_templates.name exactly
 * @param {string}  opts.to            — recipient address
 * @param {object}  opts.data          — variables for {{placeholder}} substitution
 * @param {string} [opts.orderId]      — Supabase order UUID (for dedup + audit)
 * @returns {{ sent: boolean, reason?: string }}
 */
export async function sendTransactionalEmail({ templateName, to, data = {}, orderId = null }) {
  try {
    if (!to) {
      console.warn('[emailNotifications] No recipient address, skipping', templateName);
      return { sent: false, reason: 'no_recipient' };
    }

    // ── Deduplication: skip if already sent for this order in the last 10 min ──
    if (orderId) {
      const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const { data: existing } = await supabase
        .from('email_logs')
        .select('id')
        .eq('order_id', orderId)
        .ilike('subject', `%${templateName}%`)
        .eq('status', 'sent')
        .gte('sent_at', since)
        .limit(1);
      if (existing?.length) {
        console.log(`[emailNotifications] Dedup: skip "${templateName}" for ${orderId}`);
        return { sent: false, reason: 'duplicate' };
      }
    }

    // ── Get transport ──────────────────────────────────────────────────────────
    const tc = await getTransport();
    if (!tc) {
      console.log(`[emailNotifications] Email disabled/unconfigured, skipping "${templateName}"`);
      return { sent: false, reason: 'disabled' };
    }

    // ── Fetch template ─────────────────────────────────────────────────────────
    const { data: tpl } = await supabase
      .from('email_templates')
      .select('subject, html_content, text_content')
      .eq('name', templateName)
      .maybeSingle();

    if (!tpl) {
      console.warn(`[emailNotifications] Template not found: "${templateName}"`);
      return { sent: false, reason: 'no_template' };
    }

    // ── Render & send ──────────────────────────────────────────────────────────
    const subject = render(tpl.subject, data);
    const html    = render(tpl.html_content, data);
    const text    = render(tpl.text_content, data);

    await tc.transport.sendMail({ from: tc.from, to, subject, html, text });

    await logEmail({ orderId, recipient: to, subject, status: 'sent' });
    console.log(`[emailNotifications] Sent "${templateName}" → ${to}`);
    return { sent: true };

  } catch (err) {
    console.error(`[emailNotifications] Error sending "${templateName}" to ${to}:`, err?.message);
    await logEmail({
      orderId,
      recipient: to,
      subject: templateName,
      status: 'failed',
      errorMessage: err?.message,
    });
    return { sent: false, reason: err?.message };
  }
}
