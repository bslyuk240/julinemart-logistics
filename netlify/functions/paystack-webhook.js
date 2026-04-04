/**
 * POST /api/paystack-webhook
 *
 * Receives Paystack webhook events and updates order payment status.
 *
 * Paystack events handled:
 *   charge.success  → payment_status=paid, overall_status=processing
 *   charge.failed   → payment_status=failed
 *   refund.processed → payment_status=refunded, overall_status=refunded
 *
 * Security: validates X-Paystack-Signature using HMAC-SHA512.
 */

import crypto from 'crypto';
import { headers, jsonResponse, adminClient } from './services/global-sourcing-utils.js';

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;

function verifySignature(rawBody, signature) {
  if (!PAYSTACK_SECRET) return false;
  const hash = crypto
    .createHmac('sha512', PAYSTACK_SECRET)
    .update(rawBody)
    .digest('hex');
  return hash === signature;
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });
  if (!adminClient) return jsonResponse(503, { error: 'Database not configured' });

  const signature = event.headers['x-paystack-signature'];
  const rawBody = event.body || '';

  // Reject if signature check fails (skip in dev if no secret configured)
  if (PAYSTACK_SECRET && !verifySignature(rawBody, signature)) {
    return jsonResponse(401, { error: 'Invalid signature' });
  }

  let payload;
  try { payload = JSON.parse(rawBody); }
  catch { return jsonResponse(400, { error: 'Invalid JSON' }); }

  const eventType = payload?.event;
  const data = payload?.data;

  if (!eventType || !data) return jsonResponse(400, { error: 'Malformed payload' });

  // Paystack sends the reference we set during initialization
  const reference = data.reference;
  if (!reference) return jsonResponse(200, { received: true }); // not our event, ack it

  try {
    switch (eventType) {
      case 'charge.success': {
        const { error } = await adminClient
          .from('orders')
          .update({
            payment_status: 'paid',
            overall_status: 'processing',
            payment_method: data.channel || 'paystack',
            paid_at: data.paid_at || new Date().toISOString(),
            updated_at: new Date().toISOString(),
            metadata: adminClient.rpc ? undefined : undefined, // keep existing metadata
          })
          .eq('payment_reference', reference)
          .eq('payment_status', 'pending'); // idempotent — won't double-update

        if (error) {
          console.error('paystack-webhook: failed to update order', reference, error.message);
          // Return 200 anyway so Paystack doesn't retry — we'll investigate via webhook_errors
          await adminClient.from('webhook_errors').insert({
            source: 'paystack',
            event_type: eventType,
            payload,
            error_message: error.message,
          }).catch(() => {});
        }
        break;
      }

      case 'charge.failed': {
        await adminClient
          .from('orders')
          .update({
            payment_status: 'failed',
            updated_at: new Date().toISOString(),
          })
          .eq('payment_reference', reference)
          .eq('payment_status', 'pending');
        break;
      }

      case 'refund.processed': {
        await adminClient
          .from('orders')
          .update({
            payment_status: 'refunded',
            overall_status: 'refunded',
            updated_at: new Date().toISOString(),
          })
          .eq('payment_reference', reference);
        break;
      }

      default:
        // Unhandled event — ack it silently
        break;
    }

    return jsonResponse(200, { received: true });
  } catch (err) {
    console.error('paystack-webhook error:', err?.message);
    // Always return 200 to Paystack to prevent retries — errors logged to webhook_errors
    await adminClient.from('webhook_errors').insert({
      source: 'paystack',
      event_type: eventType,
      payload,
      error_message: err?.message || String(err),
    }).catch(() => {});
    return jsonResponse(200, { received: true });
  }
}
