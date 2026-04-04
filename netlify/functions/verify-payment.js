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

    if (!json?.status || pd?.status !== 'success') {
      return jsonResponse(400, {
        success: false,
        error: 'Payment not confirmed by Paystack',
        paystack_status: pd?.status ?? 'unknown',
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
    .select('id, payment_reference, overall_status, total_amount, customer_name, customer_email')
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
      .select('id, payment_reference, overall_status, total_amount, customer_name, customer_email')
      .eq('payment_reference', payment_reference)
      .maybeSingle();
    orderRow = existing;
  }

  if (!orderRow) {
    return jsonResponse(404, { success: false, error: 'Order not found' });
  }

  return jsonResponse(200, {
    success: true,
    order: {
      id: orderRow.id,
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
