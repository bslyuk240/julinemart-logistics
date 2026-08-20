/**
 * Wraps sendPushToCustomer for rider-targeted pushes specifically, adding
 * a persistent history row (rider_notifications) alongside the actual push
 * delivery — rider-app-ux-rebuild.md #18. Customer-facing pushes
 * (order_update etc.) keep calling sendPushToCustomer directly; this is
 * only for the handful of call sites that push to a rider.
 *
 * Best-effort on the history write — a DB failure here must never block
 * the push itself, which already succeeded or failed independently.
 */
import { sendPushToCustomer } from './pushNotifications.js';

export async function sendRiderPush(adminClient, riderId, input) {
  const pushResult = await sendPushToCustomer(riderId, input);

  try {
    await adminClient.from('rider_notifications').insert({
      rider_id: riderId,
      type: String(input?.type || 'order_update'),
      title: String(input?.title || '').trim(),
      message: String(input?.message || '').trim(),
      data: input?.data && typeof input.data === 'object' ? input.data : {},
    });
  } catch (err) {
    console.error('sendRiderPush: rider_notifications insert failed:', err?.message || err);
  }

  return pushResult;
}
