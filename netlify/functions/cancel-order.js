/**
 * POST /.netlify/functions/cancel-order
 *
 * Customer-facing, public endpoint.
 * Cancels an order if it hasn't been picked up / shipped yet.
 * If the order was paid via Paystack, a full refund is automatically initiated.
 *
 * Body: { order_id: string, reason?: string }
 *
 * Non-cancellable sub_order statuses (goods already moving):
 *   picked_up | in_transit | out_for_delivery | delivered
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY || '';

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Statuses that mean goods are already in motion — cannot cancel
const SHIPPED_STATUSES = new Set(['picked_up', 'in_transit', 'out_for_delivery', 'delivered']);

async function initiatePaystackRefund(transactionRef, amountKobo, reason) {
  if (!PAYSTACK_SECRET) {
    console.error('cancel-order: PAYSTACK_SECRET_KEY not set — skipping refund');
    return null;
  }

  const payload = {
    transaction: transactionRef,
    currency: 'NGN',
  };
  if (amountKobo && amountKobo > 0) payload.amount = amountKobo;
  if (reason) payload.merchant_note = reason;

  try {
    const res = await fetch('https://api.paystack.co/refund', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (!res.ok || !data.status) {
      console.error('cancel-order: Paystack refund failed:', data);
      return null;
    }

    console.log('cancel-order: Paystack refund initiated:', data.data?.id);
    return data.data;
  } catch (err) {
    console.error('cancel-order: Paystack refund error:', err);
    return null;
  }
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ success: false, error: 'Method not allowed' }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ success: false, error: 'Invalid JSON' }),
    };
  }

  const { order_id, reason = 'Customer cancelled order' } = body;

  if (!order_id) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ success: false, error: 'order_id is required' }),
    };
  }

  try {
    // 1. Fetch the order with sub_orders
    const { data: order, error: fetchErr } = await supabase
      .from('orders')
      .select(`
        id, order_number, overall_status, payment_status, payment_reference,
        total_amount, customer_email, customer_name,
        sub_orders ( id, status )
      `)
      .eq('id', order_id)
      .maybeSingle();

    if (fetchErr || !order) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ success: false, error: 'Order not found' }),
      };
    }

    // 2. Already cancelled or delivered — nothing to do
    if (order.overall_status === 'cancelled') {
      return {
        statusCode: 409,
        headers,
        body: JSON.stringify({ success: false, error: 'Order is already cancelled' }),
      };
    }

    if (order.overall_status === 'delivered') {
      return {
        statusCode: 409,
        headers,
        body: JSON.stringify({ success: false, error: 'Delivered orders cannot be cancelled. Please raise a return request instead.' }),
      };
    }

    // 3. Check sub_orders — reject if any item is already in motion
    const subOrders = order.sub_orders || [];
    const shippedSub = subOrders.find((so) => SHIPPED_STATUSES.has(so.status));

    if (shippedSub) {
      return {
        statusCode: 409,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'This order cannot be cancelled because it has already been picked up for delivery. Please contact support.',
          sub_order_status: shippedSub.status,
        }),
      };
    }

    // 4. Cancel the main order
    const { error: updateOrderErr } = await supabase
      .from('orders')
      .update({ overall_status: 'cancelled' })
      .eq('id', order_id);

    if (updateOrderErr) throw updateOrderErr;

    // 5. Cancel all sub_orders that aren't already terminal
    if (subOrders.length > 0) {
      const subIds = subOrders.map((so) => so.id);
      await supabase
        .from('sub_orders')
        .update({ status: 'cancelled' })
        .in('id', subIds)
        .not('status', 'in', '("delivered","returned","failed")');
    }

    // 6. Auto-refund if paid via Paystack
    let refundResult = null;
    let refundRecord = null;

    const isPaid = order.payment_status === 'paid' && order.payment_reference;

    if (isPaid) {
      const amountKobo = Math.round((Number(order.total_amount) || 0) * 100);
      refundResult = await initiatePaystackRefund(order.payment_reference, amountKobo, reason);

      if (refundResult) {
        // Update payment_status to refunded
        await supabase
          .from('orders')
          .update({ payment_status: 'refunded' })
          .eq('id', order_id);

        // Record the refund
        const { data: rec } = await supabase
          .from('refund_records')
          .insert({
            order_id: order.id,
            amount: Number(order.total_amount),
            currency: 'NGN',
            reason,
            status: refundResult.status || 'pending',
            paystack_refund_id: String(refundResult.id || ''),
            paystack_transaction_ref: order.payment_reference,
            paystack_status: refundResult.status,
            paystack_raw: refundResult,
            initiated_by: 'customer',
            completed_at: refundResult.status === 'processed' ? new Date().toISOString() : null,
          })
          .select()
          .single();

        refundRecord = rec;
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: isPaid
          ? 'Order cancelled. Your refund has been initiated and will arrive within 5–10 business days.'
          : 'Order cancelled successfully.',
        data: {
          order_id: order.id,
          order_number: order.order_number,
          was_paid: isPaid,
          refund_initiated: Boolean(refundResult),
          refund_expected_at: refundResult?.expected_at || null,
          refund_id: refundResult?.id || null,
        },
      }),
    };
  } catch (err) {
    console.error('cancel-order error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: err?.message || 'Failed to cancel order' }),
    };
  }
}
