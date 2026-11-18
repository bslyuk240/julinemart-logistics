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
import { recordInfluencerSaleForPaidOrder } from './services/influencer-order-sale.js';
import { notifyOnPaidOrder } from './services/paidOrderNotify.js';
import { sendWebhookEvent } from './services/webhookDelivery.js';
import { recordRewardsForPaidOrder, reverseRewardsForOrder } from './services/rewards-hooks.js';
import { resolveOrderReference } from './services/paystack-reference.js';

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

  // Fail closed: with no secret configured the signature cannot be checked, so
  // nothing is trusted (Paystack retries until the secret is set).
  if (!PAYSTACK_SECRET) {
    return jsonResponse(503, { error: 'Webhook secret not configured' });
  }
  if (!verifySignature(rawBody, signature)) {
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
    // Paystack's reference may carry the PWA's per-attempt suffix; map it back to
    // the order's own payment_reference before looking anything up.
    const orderRef = await resolveOrderReference(adminClient, reference);

    switch (eventType) {
      case 'charge.success': {
        // Check if this is a vendor return debit payment
        const metadata = data.metadata || {};
        if (metadata.type === 'vendor_return_debit' && metadata.debit_id) {
          const { error: debitErr } = await adminClient
            .from('vendor_return_debits')
            .update({
              status: 'paid_back',
              recovery_method: 'paystack',
              updated_at: new Date().toISOString(),
            })
            .eq('id', metadata.debit_id)
            .eq('status', 'pending');

          if (debitErr) {
            console.error('paystack-webhook: failed to update vendor debit', metadata.debit_id, debitErr.message);
          }
          return jsonResponse(200, { received: true });
        }

        // Captured before the update purely to report an accurate
        // previous_status on the order.updated webhook below.
        const { data: preUpdateOrder } = await adminClient
          .from('orders')
          .select('overall_status, total_amount')
          .eq('payment_reference', orderRef)
          .maybeSingle();

        // Never confirm an order the cleared amount does not cover (the order
        // total is already net of vouchers and JulinePoints).
        if (
          preUpdateOrder &&
          (Number(data.amount) || 0) / 100 + 2 < Number(preUpdateOrder.total_amount)
        ) {
          console.error('paystack-webhook: underpaid', reference, data.amount, preUpdateOrder.total_amount);
          await adminClient.from('webhook_errors').insert({
            source: 'paystack',
            event_type: eventType,
            payload,
            error_message: `Underpaid: paid ${(Number(data.amount) || 0) / 100}, order total ${preUpdateOrder.total_amount}`,
          }).catch(() => {});
          break;
        }

        const { data: updatedOrder, error } = await adminClient
          .from('orders')
          .update({
            payment_status: 'paid',
            overall_status: 'processing',
            payment_method: data.channel || 'paystack',
            paystack_reference: reference,
            paid_at: data.paid_at || new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('payment_reference', orderRef)
          .eq('payment_status', 'pending') // idempotent — won't double-update
          .select('id, order_number, customer_name, customer_email, total_amount, overall_status')
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

        if (updatedOrder?.id) {
          sendWebhookEvent('order.updated', {
            order_id: updatedOrder.id,
            order_number: updatedOrder.order_number,
            previous_status: preUpdateOrder?.overall_status || null,
            status: updatedOrder.overall_status,
          }).catch((e) => console.warn('paystack-webhook: webhook dispatch failed', e?.message || e));

          try {
            await notifyOnPaidOrder(adminClient, updatedOrder.id, updatedOrder.order_number);
          } catch (e) {
            console.warn('paystack-webhook: paid order notify', e?.message || e);
          }

          // JulinePoints: pending purchase/referral awards. Never blocks payment.
          await recordRewardsForPaidOrder(adminClient, updatedOrder.id);

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
          .eq('payment_reference', orderRef)
          .eq('payment_status', 'pending');
        break;
      }

      case 'refund.processed': {
        const { data: preRefundOrder } = await adminClient
          .from('orders')
          .select('overall_status')
          .eq('payment_reference', orderRef)
          .maybeSingle();

        const { data: refundedOrder } = await adminClient
          .from('orders')
          .update({
            payment_status: 'refunded',
            overall_status: 'refunded',
            updated_at: new Date().toISOString(),
          })
          .eq('payment_reference', orderRef)
          .select('id, order_number, total_amount')
          .maybeSingle();

        // JulinePoints: restore redeemed points only for a FULL refund. A partial
        // refund leaves points untouched (policy for partial returns is open).
        if (refundedOrder?.id) {
          const refundNgn = data.amount != null ? Number(data.amount) / 100 : null;
          if (refundNgn == null || refundNgn + 1 >= Number(refundedOrder.total_amount)) {
            await reverseRewardsForOrder(adminClient, refundedOrder.id, 'order_refunded');
          }
        }

        if (refundedOrder?.id) {
          sendWebhookEvent('order.updated', {
            order_id: refundedOrder.id,
            order_number: refundedOrder.order_number,
            previous_status: preRefundOrder?.overall_status || null,
            status: 'refunded',
          }).catch((e) => console.warn('paystack-webhook: webhook dispatch failed', e?.message || e));
        }
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
