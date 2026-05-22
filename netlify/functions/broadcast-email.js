/**
 * POST /api/broadcast-email  — Admin only
 * Sends a newsletter / broadcast email to customers, vendors, or both.
 *
 * Body:
 *   audience  : 'customers' | 'vendors' | 'both'
 *   subject   : string
 *   body      : string  (plain text — rendered inside a simple wrapper)
 */

import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import { decryptEmailConfigSecrets } from '../../shared/emailSecretsCrypto.js';
import { buildCustomSmtpTransportOptions } from '../../shared/smtpTransport.js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';
const adminClient = createClient(supabaseUrl, serviceKey);

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ── Transport (mirrors emailNotifications.js logic) ───────────────────────────

function buildEnvTransport() {
  const provider = (process.env.EMAIL_PROVIDER || 'gmail').toLowerCase();
  if (provider === 'sendgrid') {
    return { host: 'smtp.sendgrid.net', port: 587, auth: { user: 'apikey', pass: process.env.SENDGRID_API_KEY } };
  }
  if (provider === 'smtp') {
    const host = process.env.SMTP_HOST;
    const port = parseInt(process.env.SMTP_PORT || '587', 10);
    return { host, port, secure: process.env.SMTP_SECURE === 'true' || port === 465, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }, ...(host ? { tls: { minVersion: 'TLSv1.2', servername: host } } : {}) };
  }
  return { service: 'gmail', auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASSWORD } };
}

async function getTransport() {
  try {
    const { data: rawCfg } = await adminClient.from('email_config').select('*').single();
    if (rawCfg) {
      if (rawCfg.email_enabled === false) return null;
      if (process.env.EMAIL_PROVIDER) {
        const from = rawCfg.email_from || process.env.EMAIL_FROM || process.env.EMAIL_USER || '';
        return { transport: nodemailer.createTransport(buildEnvTransport()), from };
      }
      const cfg = decryptEmailConfigSecrets(rawCfg);
      let transportConfig;
      switch (cfg.provider) {
        case 'gmail': transportConfig = { service: 'gmail', auth: { user: cfg.gmail_user, pass: cfg.gmail_password } }; break;
        case 'sendgrid': transportConfig = { host: 'smtp.sendgrid.net', port: 587, auth: { user: 'apikey', pass: cfg.sendgrid_api_key } }; break;
        case 'smtp': transportConfig = buildCustomSmtpTransportOptions(cfg); break;
        default: transportConfig = buildEnvTransport();
      }
      const from = cfg.email_from || cfg.gmail_user || cfg.smtp_user || process.env.EMAIL_FROM || process.env.EMAIL_USER || '';
      return { transport: nodemailer.createTransport(transportConfig), from };
    }
  } catch (_e) { /* fall through */ }
  if (process.env.EMAIL_ENABLED === 'false') return null;
  const from = process.env.EMAIL_FROM || process.env.EMAIL_USER || '';
  if (!from) return null;
  return { transport: nodemailer.createTransport(buildEnvTransport()), from };
}

// ── HTML wrapper for broadcast emails ────────────────────────────────────────

function buildHtml(subject, body, from) {
  const escaped = body
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .split('\n')
    .join('<br>');
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:32px 16px">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;max-width:600px;width:100%">
        <tr><td style="background:#7c3aed;padding:24px 32px">
          <h1 style="margin:0;color:#fff;font-size:20px">JulineMart</h1>
        </td></tr>
        <tr><td style="padding:32px">
          <h2 style="margin:0 0 16px;color:#111827;font-size:18px">${subject}</h2>
          <p style="margin:0;color:#374151;font-size:15px;line-height:1.7">${escaped}</p>
        </td></tr>
        <tr><td style="padding:16px 32px 32px;color:#9ca3af;font-size:12px">
          You received this because you have an account on JulineMart. Sent by ${from}.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: 'Method Not Allowed' };

  // Auth — admin or manager only
  const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
  if (!authHeader.startsWith('Bearer ')) return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'Unauthorized' }) };

  const anonClient = createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '', {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await anonClient.auth.getUser();
  if (authErr || !user) return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'Invalid token' }) };

  const { data: profile } = await adminClient.from('users').select('role').eq('id', user.id).single();
  if (!profile || !['admin', 'manager'].includes(profile.role)) {
    return { statusCode: 403, headers: cors, body: JSON.stringify({ error: 'Forbidden' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { audience, subject, body: emailBody } = body;
  if (!audience || !subject?.trim() || !emailBody?.trim()) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'audience, subject, and body are required' }) };
  }
  if (!['customers', 'vendors', 'both'].includes(audience)) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'audience must be customers | vendors | both' }) };
  }

  // Gather recipient emails
  const emails = new Set();

  if (audience === 'customers' || audience === 'both') {
    const { data: customers } = await adminClient.rpc('get_storefront_customers');
    for (const c of customers || []) { if (c.email) emails.add(c.email); }
  }

  if (audience === 'vendors' || audience === 'both') {
    const { data: vendors } = await adminClient
      .from('vendors')
      .select('email')
      .eq('is_active', true);
    for (const v of vendors || []) { if (v.email) emails.add(v.email); }
  }

  if (emails.size === 0) {
    return { statusCode: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ success: true, sent: 0, failed: 0, message: 'No recipients found' }) };
  }

  // Get transport
  const tx = await getTransport();
  if (!tx) {
    return { statusCode: 503, headers: cors, body: JSON.stringify({ error: 'Email is not configured or disabled' }) };
  }

  const html = buildHtml(subject.trim(), emailBody.trim(), tx.from);
  let sent = 0, failed = 0;

  for (const email of emails) {
    try {
      await tx.transport.sendMail({
        from: tx.from,
        to: email,
        subject: subject.trim(),
        text: emailBody.trim(),
        html,
      });
      sent++;
    } catch (err) {
      console.error(`[broadcast-email] Failed to send to ${email}:`, err?.message);
      failed++;
    }
  }

  return {
    statusCode: 200,
    headers: { ...cors, 'Content-Type': 'application/json' },
    body: JSON.stringify({ success: true, sent, failed, total: emails.size }),
  };
};
