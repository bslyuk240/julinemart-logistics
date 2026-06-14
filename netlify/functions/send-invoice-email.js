/**
 * POST /.netlify/functions/send-invoice-email
 *
 * Accepts a base64-encoded PDF invoice and emails it to the customer.
 * The PDF is generated client-side by the PWA and sent here for delivery.
 *
 * Body: { order_id, customer_email, file_name, pdf_base64 }
 */

import nodemailer from 'nodemailer';
import { createClient } from '@supabase/supabase-js';
import { decryptEmailConfigSecrets } from '../../shared/emailSecretsCrypto.js';
import { buildCustomSmtpTransportOptions } from '../../shared/smtpTransport.js';

const ALLOWED_ORIGINS = [
  'https://julinemart.com',
  'https://jlo.julinemart.com',
];

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || ''
);

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };
}

function buildEnvTransport() {
  const provider = (process.env.EMAIL_PROVIDER || 'gmail').toLowerCase();
  if (provider === 'sendgrid') {
    return { host: 'smtp.sendgrid.net', port: 587, auth: { user: 'apikey', pass: process.env.SENDGRID_API_KEY } };
  }
  if (provider === 'smtp') {
    const host = process.env.SMTP_HOST;
    const port = parseInt(process.env.SMTP_PORT || '587', 10);
    const secure = process.env.SMTP_SECURE === 'true' || port === 465;
    return { host, port, secure, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }, ...(host ? { tls: { minVersion: 'TLSv1.2', servername: host } } : {}) };
  }
  return { service: 'gmail', auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASSWORD } };
}

async function getTransport() {
  try {
    const { data: rawCfg } = await supabase.from('email_config').select('*').single();
    if (rawCfg) {
      if (rawCfg.email_enabled === false) return null;

      if (process.env.EMAIL_PROVIDER) {
        const from = rawCfg.email_from || process.env.EMAIL_FROM || process.env.EMAIL_USER || '';
        return { transport: nodemailer.createTransport(buildEnvTransport()), from };
      }

      const cfg = decryptEmailConfigSecrets(rawCfg);
      let transportConfig;
      switch (cfg.provider) {
        case 'gmail':
          transportConfig = { service: 'gmail', auth: { user: cfg.gmail_user, pass: cfg.gmail_password } };
          break;
        case 'sendgrid':
          transportConfig = { host: 'smtp.sendgrid.net', port: 587, auth: { user: 'apikey', pass: cfg.sendgrid_api_key } };
          break;
        case 'smtp':
          transportConfig = buildCustomSmtpTransportOptions(cfg);
          break;
        default:
          transportConfig = buildEnvTransport();
      }
      const from = cfg.email_from || cfg.gmail_user || cfg.smtp_user || process.env.EMAIL_FROM || process.env.EMAIL_USER || '';
      return { transport: nodemailer.createTransport(transportConfig), from };
    }
  } catch (_e) {
    // DB unavailable — fall through to env
  }

  if (process.env.EMAIL_ENABLED === 'false') return null;
  const from = process.env.EMAIL_FROM || process.env.EMAIL_USER || '';
  if (!from) return null;
  return { transport: nodemailer.createTransport(buildEnvTransport()), from };
}

export const handler = async (event) => {
  const origin = event.headers?.origin || event.headers?.Origin || '';
  const headers = corsHeaders(origin);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Invalid JSON' }) };
  }

  const { order_id, customer_email, file_name, pdf_base64 } = body;

  if (!customer_email || !pdf_base64) {
    return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'customer_email and pdf_base64 are required' }) };
  }

  if (pdf_base64.length > 5 * 1024 * 1024) {
    return { statusCode: 413, headers, body: JSON.stringify({ success: false, error: 'PDF too large' }) };
  }

  const tc = await getTransport();
  if (!tc) {
    return { statusCode: 503, headers, body: JSON.stringify({ success: false, error: 'Email service is not configured' }) };
  }

  const safeFileName = file_name || `Invoice-${order_id || 'order'}.pdf`;
  const subject = `Your JulineMart Invoice – ${safeFileName.replace('.pdf', '')}`;

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
      <div style="background:#77088a;padding:24px 32px;">
        <h1 style="color:#fff;margin:0;font-size:22px;">JulineMart</h1>
        <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:13px;">Your trusted marketplace</p>
      </div>
      <div style="padding:32px;background:#fff;">
        <h2 style="color:#1f2937;margin-top:0;">Your Invoice is Ready</h2>
        <p style="color:#4b5563;line-height:1.6;">
          Please find your invoice attached to this email. You can save or print it for your records.
        </p>
        <p style="color:#4b5563;line-height:1.6;">
          If you have any questions about your order, please reply to this email or contact our support team.
        </p>
      </div>
      <div style="background:#f9fafb;padding:16px 32px;text-align:center;">
        <p style="color:#9ca3af;font-size:12px;margin:0;">
          Thank you for shopping with JulineMart &mdash; <a href="https://julinemart.com" style="color:#77088a;">julinemart.com</a>
        </p>
      </div>
    </div>
  `;

  try {
    await tc.transport.sendMail({
      from: tc.from,
      to: customer_email,
      subject,
      html,
      text: `Your JulineMart invoice is attached.\n\nThank you for shopping with us!\nhttps://julinemart.com`,
      attachments: [
        {
          filename: safeFileName,
          content: Buffer.from(pdf_base64, 'base64'),
          contentType: 'application/pdf',
        },
      ],
    });

    // Audit log
    try {
      await supabase.from('email_logs').insert({
        order_id: order_id || null,
        recipient: customer_email,
        subject,
        status: 'sent',
        sent_at: new Date().toISOString(),
      });
    } catch (_e) {
      // Non-fatal
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, message: 'Invoice emailed successfully' }),
    };
  } catch (err) {
    console.error('[send-invoice-email] Send failed:', err?.message);
    try {
      await supabase.from('email_logs').insert({
        order_id: order_id || null,
        recipient: customer_email,
        subject,
        status: 'failed',
        error_message: err?.message || 'Unknown error',
        sent_at: new Date().toISOString(),
      });
    } catch (_e) {/* ignore */}

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: 'Failed to send invoice email' }),
    };
  }
};
