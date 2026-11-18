/**
 * Called from the single pending->paid transition (verify-payment and
 * paystack-webhook). Records PENDING purchase/referral awards for the order;
 * nothing is credited until the vesting sweep confirms delivery and the
 * return hold. Idempotent in the database (unique per order / per referee) and
 * must never block or fail payment confirmation, so every error is swallowed
 * after logging.
 */
export async function recordRewardsForPaidOrder(client, orderId) {
  try {
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
