/**
 * POST /.netlify/functions/resend-webhook
 *
 * Receives Resend delivery-event webhooks and updates email_logs with the
 * real outcome of a send (delivered / bounced / complained / delayed),
 * closing the gap where email_logs only ever recorded "accepted by Resend"
 * at send time — never what happened to the message afterwards.
 *
 * Configure in the Resend dashboard (Webhooks): point it at this URL,
 * subscribe to email.delivered / email.bounced / email.complained /
 * email.delivery_delayed, then set RESEND_WEBHOOK_SECRET (the "whsec_…"
 * signing secret Resend shows you) in Netlify env vars.
 *
 * Resend signs webhooks using the Svix format:
 *   svix-id, svix-timestamp, svix-signature headers;
 *   signed content = `${svix-id}.${svix-timestamp}.${rawBody}`;
 *   HMAC-SHA256 using the base64 portion of the secret after "whsec_".
 * https://resend.com/docs/dashboard/webhooks/verify-webhooks-requests
 */

import crypto from 'crypto';
import { headers, jsonResponse, adminClient } from './services/global-sourcing-utils.js';

const WEBHOOK_SECRET = process.env.RESEND_WEBHOOK_SECRET || '';
const TOLERANCE_SECONDS = 5 * 60;

const STATUS_BY_EVENT = {
  'email.delivered': 'delivered',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
  'email.delivery_delayed': 'delayed',
};

function verifySignature(rawBody, svixId, svixTimestamp, svixSignature) {
  if (!WEBHOOK_SECRET || !svixId || !svixTimestamp || !svixSignature) return false;

  const now = Math.floor(Date.now() / 1000);
  const ts = parseInt(svixTimestamp, 10);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > TOLERANCE_SECONDS) return false;

  const secretB64 = WEBHOOK_SECRET.startsWith('whsec_')
    ? WEBHOOK_SECRET.slice('whsec_'.length)
    : WEBHOOK_SECRET;
  let secretKey;
  try {
    secretKey = Buffer.from(secretB64, 'base64');
  } catch {
    return false;
  }

  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
  const expected = crypto.createHmac('sha256', secretKey).update(signedContent).digest('base64');

  return svixSignature
    .split(' ')
    .some((entry) => {
      const [, sig] = entry.split(',');
      if (!sig || sig.length !== expected.length) return false;
      return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    });
}

function extractReason(data) {
  return (
    data?.bounce?.message ||
    data?.bounce?.type ||
    data?.reason ||
    data?.complaint?.type ||
    null
  );
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });
  if (!adminClient) return jsonResponse(503, { error: 'Database not configured' });

  const rawBody = event.body || '';
  const h = event.headers || {};

  if (!verifySignature(rawBody, h['svix-id'], h['svix-timestamp'], h['svix-signature'])) {
    return jsonResponse(401, { error: 'Invalid signature' });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON' });
  }

  const eventType = payload?.type;
  const data = payload?.data;
  const status = STATUS_BY_EVENT[eventType];

  // Unsubscribed/unhandled event type (e.g. email.sent, email.opened) — ack it.
  if (!status || !data?.email_id) {
    return jsonResponse(200, { received: true });
  }

  try {
    const { error } = await adminClient
      .from('email_logs')
      .update({
        status,
        error_message: status === 'bounced' || status === 'complained' ? extractReason(data) : null,
        delivery_updated_at: new Date().toISOString(),
      })
      .eq('resend_message_id', data.email_id);

    if (error) {
      console.error('[resend-webhook] Failed to update email_logs:', error.message);
    }
  } catch (err) {
    console.error('[resend-webhook] Unexpected error updating email_logs:', err?.message);
  }

  return jsonResponse(200, { received: true });
}
