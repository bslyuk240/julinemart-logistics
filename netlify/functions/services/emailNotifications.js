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
import { decryptEmailConfigSecrets } from '../../../shared/emailSecretsCrypto.js';
import { buildCustomSmtpTransportOptions } from '../../../shared/smtpTransport.js';
import { sendResendEmail, sendResendBatch, verifyResendKey, RESEND_BATCH_LIMIT } from '../../../shared/resendMail.js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || ''
);

// ── Transport helpers ─────────────────────────────────────────────────────────

function buildEnvTransport() {
  const provider = envProvider() || 'gmail';
  if (provider === 'sendgrid') {
    return {
      host: 'smtp.sendgrid.net',
      port: 587,
      auth: { user: 'apikey', pass: process.env.SENDGRID_API_KEY },
    };
  }
  if (provider === 'smtp') {
    const host = process.env.SMTP_HOST;
    const port = parseInt(process.env.SMTP_PORT || '587', 10);
    const secure = process.env.SMTP_SECURE === 'true' || port === 465;
    return {
      host,
      port,
      secure,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
      ...(host ? { tls: { minVersion: 'TLSv1.2', servername: host } } : {}),
    };
  }
  return {
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASSWORD },
  };
}

function envProvider() {
  return (process.env.EMAIL_PROVIDER || '').toLowerCase();
}

function wrapResendTransport(apiKey, from) {
  return {
    kind: 'resend',
    apiKey,
    from,
    sendMail: async (opts) =>
      sendResendEmail(apiKey, {
        from: opts.from || from,
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
        attachments: opts.attachments,
        replyTo: opts.replyTo,
      }),
    verify: () => verifyResendKey(apiKey),
  };
}

function wrapSmtpTransport(transportConfig, from) {
  const transport = nodemailer.createTransport(transportConfig);
  return {
    kind: 'smtp',
    from,
    sendMail: (opts) => transport.sendMail({ from: opts.from || from, ...opts }),
    verify: () => transport.verify(),
  };
}

function mailerFromEnv(from) {
  if (envProvider() === 'resend') {
    const key = process.env.RESEND_API_KEY || '';
    if (!key) return null;
    return wrapResendTransport(key, from);
  }
  return wrapSmtpTransport(buildEnvTransport(), from);
}

function finish(mailer) {
  if (!mailer) return null;
  return { ...mailer, transport: mailer };
}

/**
 * Returns a mailer `{ kind, from, sendMail, verify, transport, apiKey? }` or null if
 * email is disabled / not configured. `transport` is an alias of the mailer so
 * existing `tc.transport.sendMail` callers keep working when the provider is Resend.
 */
async function getTransport() {
  try {
    const { data: rawCfg } = await supabase.from('email_config').select('*').single();

    if (rawCfg) {
      if (rawCfg.email_enabled === false) return null;

      const cfg = decryptEmailConfigSecrets(rawCfg);
      const from =
        cfg.email_from ||
        rawCfg.email_from ||
        process.env.EMAIL_FROM ||
        process.env.EMAIL_USER ||
        '';

      // Operational mail (orders, vendor activation, Skola bulk, etc.) uses
      // Resend whenever a key is present. Auth mail (invite, password reset,
      // magic link) never comes through this function — it is sent by
      // Supabase Auth using the project's Custom SMTP settings. Leave that
      // SMTP as-is; do not point Auth at Resend.
      const resendKey = cfg.resend_api_key || process.env.RESEND_API_KEY || '';
      if (resendKey) {
        return finish(wrapResendTransport(resendKey, from));
      }

      const resolvedFrom =
        from ||
        cfg.gmail_user ||
        cfg.smtp_user ||
        process.env.EMAIL_FROM ||
        process.env.EMAIL_USER ||
        '';

      if (process.env.EMAIL_PROVIDER) {
        return finish(mailerFromEnv(resolvedFrom));
      }

      if (cfg.provider === 'resend') {
        return null;
      }

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
          transportConfig = buildCustomSmtpTransportOptions(cfg);
          break;
        default:
          return finish(mailerFromEnv(resolvedFrom));
      }

      return finish(wrapSmtpTransport(transportConfig, resolvedFrom));
    }
  } catch (_e) {
    // DB unavailable — fall through to env
  }

  if (process.env.EMAIL_ENABLED === 'false') return null;

  const from = process.env.EMAIL_FROM || process.env.EMAIL_USER || '';
  if (!from) return null;

  if (process.env.RESEND_API_KEY) {
    return finish(wrapResendTransport(process.env.RESEND_API_KEY, from));
  }

  return finish(mailerFromEnv(from));
}

export { getTransport, RESEND_BATCH_LIMIT };

// ── Template rendering ────────────────────────────────────────────────────────

// Escapes HTML-significant characters in a substituted value. Applied to the
// HTML body only — callers now include the external /api/v1/notifications/email
// route, where `data` values come from an untrusted caller and were previously
// spliced into the HTML body unescaped (real phishing/markup-injection risk,
// not just theoretical: any {{variable}} could carry attacker-controlled
// <a>/<img>/<script>-shaped markup into a legitimate JulineMart-branded email).
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function render(template, data, { escape = false } = {}) {
  let out = template || '';
  for (const [key, val] of Object.entries(data || {})) {
    const safe = val == null ? '' : escape ? escapeHtml(val) : String(val);
    out = out.replace(new RegExp(`{{${key}}}`, 'g'), safe);
  }
  return out;
}

// ── Audit logging ─────────────────────────────────────────────────────────────

async function logEmail({ orderId, recipient, subject, status, errorMessage, resendMessageId }) {
  try {
    await supabase.from('email_logs').insert({
      order_id: orderId || null,
      recipient,
      subject,
      status,
      error_message: errorMessage || null,
      resend_message_id: resendMessageId || null,
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
    const html    = render(tpl.html_content, data, { escape: true });
    const text    = render(tpl.text_content, data);

    const sendResult = await tc.sendMail({ from: tc.from, to, subject, html, text });

    await logEmail({
      orderId,
      recipient: to,
      subject,
      status: 'sent',
      resendMessageId: tc.kind === 'resend' ? sendResult?.id : null,
    });
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Send one template to many recipients. Uses Resend's batch API when that
 * is the configured provider (up to 100 per HTTP call); otherwise sends
 * sequentially through SMTP.
 *
 * @param {object} opts
 * @param {string} opts.templateName
 * @param {Array<{ to: string, data?: object, order_id?: string }>} opts.recipients
 * @param {object} [opts.data] shared {{variable}} defaults merged under each recipient
 * @returns {{ sent: number, failed: number, skipped: number, results: object[] }}
 */
export async function sendTransactionalEmailBulk({ templateName, recipients, data: sharedData = {} }) {
  const empty = { sent: 0, failed: 0, skipped: 0, results: [] };
  if (!Array.isArray(recipients) || recipients.length === 0) {
    return { ...empty, reason: 'no_recipients' };
  }

  const tc = await getTransport();
  if (!tc) return { ...empty, reason: 'disabled' };

  const { data: tpl } = await supabase
    .from('email_templates')
    .select('subject, html_content, text_content')
    .eq('name', templateName)
    .maybeSingle();
  if (!tpl) return { ...empty, reason: 'no_template' };

  const prepared = [];
  for (const raw of recipients) {
    const to = String(raw?.to || '').trim();
    if (!EMAIL_RE.test(to)) {
      empty.results.push({ to, sent: false, reason: 'invalid_to' });
      empty.skipped += 1;
      continue;
    }
    const merged = { ...sharedData, ...(raw.data && typeof raw.data === 'object' ? raw.data : {}) };
    prepared.push({
      to,
      orderId: raw.order_id ? String(raw.order_id) : null,
      subject: render(tpl.subject, merged),
      html: render(tpl.html_content, merged, { escape: true }),
      text: render(tpl.text_content, merged),
    });
  }

  const results = [...empty.results];

  if (tc.kind === 'resend' && tc.apiKey && prepared.length > 0) {
    // Chunk here (rather than relying on sendResendBatch's internal chunking)
    // so a failure in one chunk's HTTP call only marks that chunk's recipients
    // as failed, not every recipient across the whole batch.
    for (let i = 0; i < prepared.length; i += RESEND_BATCH_LIMIT) {
      const chunk = prepared.slice(i, i + RESEND_BATCH_LIMIT);
      let items = null;
      let chunkError = null;
      try {
        const [chunkRes] = await sendResendBatch(
          tc.apiKey,
          chunk.map((p) => ({ from: tc.from, to: [p.to], subject: p.subject, html: p.html, text: p.text })),
        );
        items = Array.isArray(chunkRes?.data) ? chunkRes.data : null;
      } catch (err) {
        chunkError = err;
      }

      for (let j = 0; j < chunk.length; j++) {
        const p = chunk[j];
        const item = items ? items[j] : null;

        if (chunkError) {
          await logEmail({
            orderId: p.orderId,
            recipient: p.to,
            subject: p.subject,
            status: 'failed',
            errorMessage: chunkError.message,
          });
          results.push({ to: p.to, sent: false, reason: chunkError.message });
          empty.failed += 1;
          continue;
        }

        // Resend only confirms a message as accepted when it comes back with
        // an id. Anything else (an error entry, or a missing/short response)
        // means this specific recipient was not actually accepted, even
        // though the HTTP call for the batch itself returned 200.
        if (item?.id) {
          await logEmail({
            orderId: p.orderId,
            recipient: p.to,
            subject: p.subject,
            status: 'sent',
            resendMessageId: item.id,
          });
          results.push({ to: p.to, sent: true, id: item.id });
          empty.sent += 1;
        } else {
          const reason = item?.message || item?.error || 'Resend did not confirm this recipient';
          await logEmail({
            orderId: p.orderId,
            recipient: p.to,
            subject: p.subject,
            status: 'failed',
            errorMessage: reason,
          });
          results.push({ to: p.to, sent: false, reason });
          empty.failed += 1;
        }
      }
    }
    return { sent: empty.sent, failed: empty.failed, skipped: empty.skipped, results };
  }

  for (const p of prepared) {
    try {
      await tc.sendMail({ from: tc.from, to: p.to, subject: p.subject, html: p.html, text: p.text });
      await logEmail({ orderId: p.orderId, recipient: p.to, subject: p.subject, status: 'sent' });
      results.push({ to: p.to, sent: true });
      empty.sent += 1;
    } catch (err) {
      await logEmail({
        orderId: p.orderId,
        recipient: p.to,
        subject: p.subject,
        status: 'failed',
        errorMessage: err?.message,
      });
      results.push({ to: p.to, sent: false, reason: err?.message });
      empty.failed += 1;
    }
  }

  return { sent: empty.sent, failed: empty.failed, skipped: empty.skipped, results };
}
