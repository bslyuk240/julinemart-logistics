/**
 * Gift order cancellation rules, shared by customer cancel-order and the
 * admin gift ops "cancel & refund" action.
 *
 * "Shipment created" for a gift = its consolidated gift sub-order has left
 * 'pending'. Both Fez shipment creation (fezCreateCore) and rider assignment
 * (assign-rider) move it to 'assigned'/'broadcasting', so anything other than
 * 'pending' means delivery has been arranged.
 */
import { releaseVoucherUsage } from '../helpers/voucherHelpers.js';
import { createPaystackRefund } from './returns-utils.js';

const GIFT_ORDER_KINDS = new Set(['gift_ready_made', 'gift_custom']);
const TERMINAL_SUB_STATUSES = ['delivered', 'returned', 'failed'];

export function isGiftOrderKind(orderKind) {
  return GIFT_ORDER_KINDS.has(orderKind);
}

export async function checkGiftShipmentNotCreated(client, orderId) {
  const { data: subs, error } = await client
    .from('sub_orders')
    .select('id, status, metadata')
    .eq('main_order_id', orderId);
  if (error) throw error;

  const giftSub = (subs || []).find((s) => s.metadata?.gift_fulfilment === true);
  if (giftSub && giftSub.status !== 'pending') {
    return { allowed: false, status: giftSub.status };
  }
  return { allowed: true };
}

export async function markGiftOrderCancelled(client, orderId, { note, actorEmail } = {}) {
  const { data: gift, error } = await client
    .from('gift_orders')
    .select('id, gift_status')
    .eq('order_id', orderId)
    .maybeSingle();
  if (error) throw error;
  if (!gift || gift.gift_status === 'cancelled') return null;

  const { error: updErr } = await client
    .from('gift_orders')
    .update({ gift_status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', gift.id);
  if (updErr) throw updErr;

  await client.from('gift_order_events').insert({
    gift_order_id: gift.id,
    status: 'cancelled',
    note: note || null,
    actor_email: actorEmail || null,
  });
  return gift.id;
}

export class GiftCancelError extends Error {
  constructor(message, statusCode = 409) {
    super(message);
    this.statusCode = statusCode;
  }
}

/**
 * Staff-initiated cancel, e.g. an item turned out to be out of stock.
 * Cancels first, then refunds: if the Paystack call fails the order stays
 * cancelled with payment_status still 'paid' and the failure is returned so
 * staff can retry from the refunds queue, rather than leaving a refunded
 * order live.
 */
export async function cancelGiftOrderByStaff(client, { orderId, reason, refund = true, actorEmail }) {
  const { data: order, error } = await client
    .from('orders')
    .select('id, order_number, order_kind, overall_status, payment_status, payment_reference, total_amount, metadata')
    .eq('id', orderId)
    .maybeSingle();
  if (error) throw error;
  if (!order) throw new GiftCancelError('Order not found', 404);
  if (!isGiftOrderKind(order.order_kind)) throw new GiftCancelError('Not a gift order', 400);
  if (order.overall_status === 'cancelled') throw new GiftCancelError('Order is already cancelled');
  if (order.overall_status === 'delivered') {
    throw new GiftCancelError('Delivered gifts cannot be cancelled. Use a return request instead.');
  }

  const { error: orderErr } = await client
    .from('orders')
    .update({ overall_status: 'cancelled' })
    .eq('id', orderId);
  if (orderErr) throw orderErr;

  if (order.metadata?.voucher_code) {
    await releaseVoucherUsage(client, order.metadata.voucher_code);
  }

  const { error: subErr } = await client
    .from('sub_orders')
    .update({ status: 'failed' })
    .eq('main_order_id', orderId)
    .not('status', 'in', `(${TERMINAL_SUB_STATUSES.map((s) => `"${s}"`).join(',')})`);
  if (subErr) console.error('cancelGiftOrderByStaff: sub_orders update failed:', subErr.message);

  await markGiftOrderCancelled(client, orderId, { note: reason, actorEmail });

  const result = {
    order_id: order.id,
    order_number: order.order_number,
    previous_status: order.overall_status,
    refund_attempted: false,
    refunded: false,
    refund_id: null,
    refund_error: null,
  };

  const isPaid = order.payment_status === 'paid' && order.payment_reference;
  if (!refund || !isPaid) return result;

  result.refund_attempted = true;
  try {
    const refundResult = await createPaystackRefund({
      transactionRef: order.payment_reference,
      amount: Number(order.total_amount),
      reason,
    });

    await client.from('orders').update({ payment_status: 'refunded' }).eq('id', orderId);
    await client.from('refund_records').insert({
      order_id: order.id,
      amount: Number(order.total_amount),
      currency: 'NGN',
      reason,
      status: refundResult.status || 'pending',
      paystack_refund_id: String(refundResult.id || ''),
      paystack_transaction_ref: order.payment_reference,
      paystack_status: refundResult.status,
      paystack_raw: refundResult,
      initiated_by: 'admin',
      completed_at: refundResult.status === 'processed' ? new Date().toISOString() : null,
    });

    result.refunded = true;
    result.refund_id = refundResult.id || null;
  } catch (refundErr) {
    result.refund_error = refundErr?.message || String(refundErr);
  }

  return result;
}
