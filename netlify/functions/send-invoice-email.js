/**
 * POST /.netlify/functions/send-invoice-email
 *
 * Accepts a base64-encoded PDF invoice and emails it to the customer.
 * The PDF is generated client-side by the PWA and sent here for delivery.
 * Requires the signed-in customer's Bearer token (forwarded by the PWA); the
 * invoice only goes to that customer's own address, for their own order.
 *
 * Body: { order_id, file_name, pdf_base64 }
 */

import { createClient } from '@supabase/supabase-js';
import { getTransport } from './services/emailNotifications.js';
import { authenticateCustomer } from './services/customerAuth.js';

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

  const { order_id, file_name, pdf_base64 } = body;

  if (!order_id || !pdf_base64) {
    return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'order_id and pdf_base64 are required' }) };
  }

  // Only the signed-in customer, for their own order, and only to their own
  // address — otherwise this mails any PDF to anyone from our domain.
  const { email, error: authError } = await authenticateCustomer(event);
  if (authError) {
    return { statusCode: 401, headers, body: JSON.stringify({ success: false, error: authError }) };
  }
  const { data: order } = await supabase
    .from('orders')
    .select('id, customer_email')
    .eq('id', order_id)
    .maybeSingle();
  if (!order || String(order.customer_email || '').trim().toLowerCase() !== email) {
    return { statusCode: 404, headers, body: JSON.stringify({ success: false, error: 'Order not found' }) };
  }
  const customer_email = email;

  if (pdf_base64.length > 5 * 1024 * 1024) {
    return { statusCode: 413, headers, body: JSON.stringify({ success: false, error: 'PDF too large' }) };
  }

  const tc = await getTransport();
  if (!tc) {
    return { statusCode: 503, headers, body: JSON.stringify({ success: false, error: 'Email service is not configured' }) };
  }

  const cleanName = String(file_name || '').replace(/[^\w.\- ]/g, '').slice(0, 80);
  const safeFileName = cleanName.toLowerCase().endsWith('.pdf') ? cleanName : `Invoice-${order.id}.pdf`;
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
