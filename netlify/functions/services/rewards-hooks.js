/**
 * JulinePoints hooks for the order lifecycle. Called from verify-payment,
 * paystack-webhook, cancel-order and refunds. Every function is idempotent in
 * the database and must never block or fail the payment/refund/cancel it
 * rides on (except commitForFreeOrder, whose failure is the point).
 */

async function logShortfall(client, orderId, points) {
  try {
    await client.from('activity_logs').insert({
      user_id: null,
      actor_email: null,
      action: 'REWARDS_REDEMPTION_SHORTFALL',
      resource_type: 'orders',
      resource_id: orderId,
      details: { shortfall_points: points, note: 'Points hold had lapsed and balance no longer covered it' },
      source: 'system',
    });
  } catch { /* best effort */ }
}

/**
 * Order just became paid: debit the points reserved at checkout (exactly once),
 * then record pending purchase/referral awards.
 */
export async function recordRewardsForPaidOrder(client, orderId) {
  try {
    const { data: commit, error: commitErr } = await client.rpc('rewards_commit_reservation', {
      p_order_id: orderId,
    });
    if (commitErr) console.warn('rewards commit failed:', commitErr.message);
    else if (commit?.shortfall_points > 0) await logShortfall(client, orderId, commit.shortfall_points);

    const { data, error } = await client.rpc('rewards_on_order_paid', { p_order_id: orderId });
    if (error) {
      console.warn('rewards hook failed:', error.message);
      return null;
    }
    return data;
  } catch (err) {
    console.warn('rewards hook threw:', err?.message || err);
    return null;
  }
}

/**
 * A ₦0 order paid for with points has no Paystack charge to prove payment, so
 * the points debit IS the payment: it must fully succeed before the order is
 * confirmed. Returns { ok:true } or { ok:false, error }. Orders without points
 * return ok immediately.
 */
export async function commitForFreeOrder(client, orderId, pointsRedeemed) {
  if (!pointsRedeemed || pointsRedeemed <= 0) return { ok: true };
  const { data, error } = await client.rpc('rewards_commit_reservation', { p_order_id: orderId });
  if (error || data?.status !== 'committed') {
    return { ok: false, error: 'Your JulinePoints could not be applied. Please place the order again.' };
  }
  if (data.shortfall_points > 0) {
    // Hold lapsed and the balance no longer covers it: undo the partial debit.
    await client.rpc('rewards_reverse_order', { p_order_id: orderId, p_reason: 'free_order_shortfall' });
    return { ok: false, error: 'Your JulinePoints balance changed. Please place the order again.' };
  }
  return { ok: true };
}

/** Order cancelled or fully refunded: release the hold / restore redeemed points. */
export async function reverseRewardsForOrder(client, orderId, reason = 'order_reversed') {
  try {
    const { error } = await client.rpc('rewards_reverse_order', { p_order_id: orderId, p_reason: reason });
    if (error) console.warn('rewards reverse failed:', error.message);
  } catch (err) {
    console.warn('rewards reverse threw:', err?.message || err);
  }
}
