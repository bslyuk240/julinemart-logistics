/**
 * POST /api/verify-payment
 *
 * Verifies a Paystack transaction and updates the order in Supabase.
 *
 * Body:
 *   payment_reference  — JLO reference used to look up the order (required)
 *   paystack_reference — Paystack transaction reference to verify (optional;
 *                        defaults to payment_reference when Paystack inline
 *                        was initialised with the JLO ref directly)
 *
 * Returns: { success, order: { id, payment_reference, status, total_amount },
 *            payment: { reference, amount, status } }
 */

import { headers, jsonResponse, adminClient } from './services/global-sourcing-utils.js';
import { sendTransactionalEmail } from './services/emailNotifications.js';
import { recordInfluencerSaleForPaidOrder } from './services/influencer-order-sale.js';

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });
  if (!adminClient) return jsonResponse(503, { error: 'Database not configured' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return jsonResponse(400, { error: 'Invalid JSON body' }); }

  const { payment_reference, paystack_reference } = body;
  if (!payment_reference) return jsonResponse(400, { error: 'payment_reference is required' });
  if (!PAYSTACK_SECRET_KEY) return jsonResponse(503, { error: 'Paystack not configured' });

  // Use the explicit paystack_reference if provided, otherwise assume the JLO
  // payment_reference was used as the Paystack transaction reference (inline flow).
  const txRef = paystack_reference || payment_reference;

  // ── Verify with Paystack ───────────────────────────────────────────────────
  let pd;
  try {
    const res = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(txRef)}`,
      { headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` } }
    );
    const json = await res.json();
    pd = json?.data;

    if (!json?.status || !pd) {
      return jsonResponse(400, {
        success: false,
        error: 'Payment not confirmed by Paystack',
        paystack_status: 'unknown',
        paystack_message: json?.message,
      });
    }

    if (pd.status !== 'success') {
      return jsonResponse(400, {
        success: false,
        error: pd.status === 'abandoned'
          ? 'Payment was not completed. Please try again.'
          : pd.status === 'failed'
          ? 'Payment failed. Please try a different payment method.'
          : `Payment not confirmed by Paystack (status: ${pd.status})`,
        paystack_status: pd.status,
      });
    }
  } catch (err) {
    return jsonResponse(502, { success: false, error: 'Failed to reach Paystack', message: err?.message });
  }

  // ── Update order ───────────────────────────────────────────────────────────
  const { data: updatedOrder, error: updateErr } = await adminClient
    .from('orders')
    .update({
      payment_status: 'paid',
      overall_status: 'processing',
      payment_method: pd.channel || 'paystack',
      paid_at: pd.paid_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('payment_reference', payment_reference)
    .eq('payment_status', 'pending') // idempotent — skip if already paid
    .select('id, order_number, payment_reference, overall_status, total_amount, customer_name, customer_email')
    .maybeSingle();

  if (updateErr) {
    console.error('verify-payment: update error', updateErr.message);
    return jsonResponse(500, { success: false, error: 'Failed to update order', detail: updateErr.message });
  }

  // If update matched nothing (order already paid), fetch current state
  let orderRow = updatedOrder;
  if (!orderRow) {
    const { data: existing } = await adminClient
      .from('orders')
      .select('id, order_number, payment_reference, overall_status, total_amount, customer_name, customer_email')
      .eq('payment_reference', payment_reference)
      .maybeSingle();
    orderRow = existing;
  }

  if (!orderRow) {
    return jsonResponse(404, { success: false, error: 'Order not found' });
  }

  // Send order confirmation email only when this call actually confirmed the payment
  // (updatedOrder is non-null). The paystack-webhook does the same with dedup protection.
  if (updatedOrder && orderRow.customer_email) {
    const portalUrl = process.env.CUSTOMER_PORTAL_URL || 'https://julinemart.com';
    sendTransactionalEmail({
      templateName: 'Order Confirmation',
      to: orderRow.customer_email,
      orderId: orderRow.id,
      data: {
        customerName: orderRow.customer_name || 'Customer',
        orderNumber: orderRow.order_number ?? orderRow.id,
        orderDate: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
        totalAmount: Number(orderRow.total_amount || 0).toLocaleString(),
        trackingUrl: `${portalUrl}/orders/${orderRow.order_number ?? orderRow.id}`,
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
      console.warn('verify-payment: influencer sale', e?.message || e);
    }
  }

  return jsonResponse(200, {
    success: true,
    order: {
      id: orderRow.id,
      order_number: orderRow.order_number,
      payment_reference: orderRow.payment_reference,
      status: orderRow.overall_status,
      total_amount: orderRow.total_amount,
    },
    payment: {
      reference: txRef,
      amount: (pd.amount || 0) / 100,
      status: pd.status,
    },
  });
}
