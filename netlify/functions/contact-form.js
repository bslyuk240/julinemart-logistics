/**
 * contact-form.js — PUBLIC endpoint
 * Receives a contact form submission and emails it to info@julinemart.com.
 *
 * POST /api/contact-form
 * Body: { name, email, subject, message }
 */
import nodemailer from 'nodemailer';
import { corsHeaders, preflightResponse } from './services/cors.js';

function buildTransport() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '465', 10);
  const secure = port === 465;
  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    },
    ...(host ? { tls: { minVersion: 'TLSv1.2', servername: host } } : {}),
  });
}

export async function handler(event) {
  const origin = event.headers?.origin || event.headers?.Origin || '';
  if (event.httpMethod === 'OPTIONS') return preflightResponse(origin);
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders(origin),
      body: JSON.stringify({ success: false, error: 'Method not allowed' }),
    };
  }

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      headers: corsHeaders(origin),
      body: JSON.stringify({ success: false, error: 'Invalid JSON' }),
    };
  }

  const { name, email, subject, message } = body;
  if (!name || !email || !message) {
    return {
      statusCode: 400,
      headers: corsHeaders(origin),
      body: JSON.stringify({ success: false, error: 'name, email, and message are required' }),
    };
  }

  // Basic email format check
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return {
      statusCode: 400,
      headers: corsHeaders(origin),
      body: JSON.stringify({ success: false, error: 'Invalid email address' }),
    };
  }

  if (!process.env.SMTP_PASSWORD) {
    return {
      statusCode: 503,
      headers: corsHeaders(origin),
      body: JSON.stringify({ success: false, error: 'Email not configured' }),
    };
  }

  const to = 'info@julinemart.com';
  const emailSubject = subject?.trim()
    ? `[Contact Form] ${subject.trim()}`
    : `[Contact Form] Message from ${name}`;

  const html = `
<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 16px;">
  <tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;max-width:560px;width:100%;">
      <tr><td style="background:linear-gradient(135deg,#77088a,#4a0558);padding:28px 40px;">
        <h1 style="color:#fff;margin:0;font-size:20px;font-weight:700;">New Contact Message</h1>
        <p style="color:rgba(255,255,255,0.75);margin:4px 0 0;font-size:13px;">JulineMart Contact Form</p>
      </td></tr>
      <tr><td style="padding:32px 40px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;margin-bottom:24px;">
          <tr><td style="background:#f9fafb;padding:12px 20px;border-bottom:1px solid #e5e7eb;">
            <p style="margin:0;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">From</p>
            <p style="margin:4px 0 0;font-size:15px;font-weight:600;color:#111827;">${name}</p>
          </td></tr>
          <tr><td style="background:#fff;padding:12px 20px;border-bottom:1px solid #e5e7eb;">
            <p style="margin:0;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Email</p>
            <p style="margin:4px 0 0;font-size:15px;color:#111827;"><a href="mailto:${email}" style="color:#77088a;">${email}</a></p>
          </td></tr>
          ${subject?.trim() ? `<tr><td style="background:#f9fafb;padding:12px 20px;border-bottom:1px solid #e5e7eb;">
            <p style="margin:0;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Subject</p>
            <p style="margin:4px 0 0;font-size:15px;color:#111827;">${subject.trim()}</p>
          </td></tr>` : ''}
          <tr><td style="background:#fff;padding:12px 20px;">
            <p style="margin:0;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Message</p>
            <p style="margin:4px 0 0;font-size:15px;color:#374151;line-height:1.6;white-space:pre-line;">${message.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>
          </td></tr>
        </table>
        <p style="color:#6b7280;font-size:13px;margin:0;">Reply directly to this email to respond to ${name}.</p>
      </td></tr>
      <tr><td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:16px 40px;text-align:center;">
        <p style="color:#9ca3af;font-size:12px;margin:0;">© 2026 JulineMart · <a href="https://julinemart.com" style="color:#77088a;text-decoration:none;">julinemart.com</a></p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

  try {
    const transporter = buildTransport();
    await transporter.sendMail({
      from: process.env.EMAIL_FROM || 'JulineMart <info@julinemart.com>',
      to,
      replyTo: `${name} <${email}>`,
      subject: emailSubject,
      html,
      text: `From: ${name} <${email}>\n\n${message}`,
    });

    return {
      statusCode: 200,
      headers: corsHeaders(origin),
      body: JSON.stringify({ success: true }),
    };
  } catch (err) {
    console.error('[contact-form] Send failed:', err?.message);
    return {
      statusCode: 500,
      headers: corsHeaders(origin),
      body: JSON.stringify({ success: false, error: 'Failed to send message. Please try again.' }),
    };
  }
}
