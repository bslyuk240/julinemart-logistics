/**
 * GET/POST /.netlify/functions/internal-whatsapp-webhook
 *
 * WhatsApp Cloud API webhook for the internal outreach number (Sales Rep /
 * Ops Manager agents messaging vendors and leads — see
 * netlify/functions/services/internalWhatsapp.js and migration
 * 20260828120000_internal_whatsapp_outreach.sql). Records inbound replies
 * (advances the 24h service window) and delivery/read status updates on
 * outbound messages.
 *
 * Configure in Meta's App Dashboard → WhatsApp → Configuration:
 *   Callback URL: this function's URL
 *   Verify token: WHATSAPP_WEBHOOK_VERIFY_TOKEN
 *   Subscribe to: messages
 *
 * Meta signs POST bodies with X-Hub-Signature-256 (HMAC-SHA256 over the raw
 * body, using the app secret). Verification is skipped — with a loud log,
 * not silently — if META_APP_SECRET isn't set yet; set it before relying on
 * this in production.
 */
import crypto from 'crypto';
import { headers, jsonResponse, adminClient } from './services/global-sourcing-utils.js';
import { recordInboundWhatsAppMessage } from './services/internalWhatsapp.js';

const VERIFY_TOKEN = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || '';
const APP_SECRET = process.env.META_APP_SECRET || '';

function verifySignature(rawBody, signatureHeader) {
  if (!APP_SECRET) {
    console.warn('[internal-whatsapp-webhook] META_APP_SECRET not configured — skipping signature verification. Set it before trusting this in production.');
    return true;
  }
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;
  const expected = crypto.createHmac('sha256', APP_SECRET).update(rawBody).digest('hex');
  const provided = signatureHeader.slice('sha256='.length);
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  // Meta's one-time subscription handshake.
  if (event.httpMethod === 'GET') {
    const qs = event.queryStringParameters || {};
    if (qs['hub.mode'] === 'subscribe' && qs['hub.verify_token'] === VERIFY_TOKEN && VERIFY_TOKEN) {
      return { statusCode: 200, headers: { 'Content-Type': 'text/plain' }, body: qs['hub.challenge'] || '' };
    }
    return jsonResponse(403, { error: 'Verification failed' });
  }

  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });
  if (!adminClient) return jsonResponse(503, { error: 'Database not configured' });

  const rawBody = event.body || '';
  if (!verifySignature(rawBody, event.headers?.['x-hub-signature-256'])) {
    return jsonResponse(401, { error: 'Invalid signature' });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON' });
  }

  await adminClient.from('internal_whatsapp_webhook_events').insert({ event_type: payload?.object || 'unknown', payload }).then(() => {}, () => {});

  try {
    const changes = payload?.entry?.flatMap((e) => e.changes || []) || [];
    for (const change of changes) {
      const value = change.value || {};

      for (const msg of value.messages || []) {
        if (msg.type !== 'text') continue; // images/docs/etc. not handled yet — extend here when needed
        const contact = (value.contacts || []).find((c) => c.wa_id === msg.from);
        await recordInboundWhatsAppMessage({
          from: msg.from,
          contactName: contact?.profile?.name || null,
          text: msg.text?.body || '',
          metaMessageId: msg.id,
        });
      }

      for (const status of value.statuses || []) {
        if (!status.id) continue;
        const mapped = { sent: 'sent', delivered: 'delivered', read: 'read', failed: 'failed' }[status.status];
        if (!mapped) continue;

        const { data: existingMessage } = await adminClient
          .from('internal_whatsapp_messages')
          .select('status, broadcast_id')
          .eq('meta_message_id', status.id)
          .maybeSingle();

        await adminClient
          .from('internal_whatsapp_messages')
          .update({
            status: mapped,
            ...(mapped === 'delivered' ? { delivered_at: new Date().toISOString() } : {}),
            ...(mapped === 'read' ? { read_at: new Date().toISOString() } : {}),
            ...(mapped === 'failed' ? { error_message: status.errors?.[0]?.title || null } : {}),
          })
          .eq('meta_message_id', status.id);

        // A message Meta already accepted (and counted as "sent" in a
        // broadcast's summary at send time) can later flip to failed via
        // this async callback — e.g. "User's number is part of an
        // experiment" only surfaces here, well after the synchronous send
        // response reported success. Keep giveaway_broadcasts' own counts
        // honest instead of leaving them frozen at the send-time snapshot.
        // Guarded on the message's own prior status (not just re-checking
        // the mapped value) so a duplicate webhook redelivery — Meta retries
        // aggressively — can't double-decrement.
        if (mapped === 'failed' && existingMessage?.broadcast_id && existingMessage.status !== 'failed') {
          const { data: broadcast } = await adminClient
            .from('giveaway_broadcasts')
            .select('sent_count, failed_count')
            .eq('id', existingMessage.broadcast_id)
            .maybeSingle();
          if (broadcast) {
            await adminClient
              .from('giveaway_broadcasts')
              .update({
                sent_count: Math.max(0, broadcast.sent_count - 1),
                failed_count: broadcast.failed_count + 1,
              })
              .eq('id', existingMessage.broadcast_id);
          }
        }
      }
    }
  } catch (err) {
    console.error('[internal-whatsapp-webhook] Error processing payload:', err?.message);
    // Still ack 200 — Meta retries aggressively on non-200, and the raw
    // payload is already logged above for replay/debugging.
  }

  return jsonResponse(200, { received: true });
}
