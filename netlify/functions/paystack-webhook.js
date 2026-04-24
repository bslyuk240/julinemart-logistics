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
import { sendTransactionalEmail } from './services/emailNotifications.js';
import { recordInfluencerSaleForPaidOrder } from './services/influencer-order-sale.js';

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
        const { data: updatedOrder, error } = await adminClient
          .from('orders')
          .update({
            payment_status: 'paid',
            overall_status: 'processing',
            payment_method: data.channel || 'paystack',
            paid_at: data.paid_at || new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('payment_reference', reference)
          .eq('payment_status', 'pending') // idempotent — won't double-update
          .select('id, order_number, customer_name, customer_email, total_amount')
          .maybeSingle();

        if (error) {
          console.error('paystack-webhook: failed to update order', reference, error.message);
          await adminClient.from('webhook_errors').insert({
            source: 'paystack',
            event_type: eventType,
            payload,
            error_message: error.message,
          }).catch(() => {});
        }

        // Send order confirmation email — dedup handles the case where
        // verify-payment already sent it from the browser flow
        if (updatedOrder?.customer_email) {
          const portalUrl = process.env.CUSTOMER_PORTAL_URL || 'https://julinemart.com';
          sendTransactionalEmail({
            templateName: 'Order Confirmation',
            to: updatedOrder.customer_email,
            orderId: updatedOrder.id,
            data: {
              customerName: updatedOrder.customer_name || 'Customer',
              orderNumber: updatedOrder.order_number ?? updatedOrder.id,
              orderDate: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
              totalAmount: Number(updatedOrder.total_amount || 0).toLocaleString(),
              trackingUrl: `${portalUrl}/orders/${updatedOrder.order_number ?? updatedOrder.id}`,
            },
          });
        }

        if (updatedOrder?.id) {
          try {
            const { data: fullOrder } = await adminClient
              .from('orders')
              .select('*')
              .eq('id', updatedOrder.id)
              .maybeSingle();
            if (fullOrder) await recordInfluencerSaleForPaidOrder(adminClient, fullOrder);
          } catch (e) {
            console.warn('paystack-webhook: influencer sale', e?.message || e);
          }
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
