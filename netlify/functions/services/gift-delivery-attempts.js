/**
 * Gift local-rider failed-delivery policy.
 *
 *  - Redelivery is free (JulineMart pays) for the first failed attempt.
 *  - After 2 failed attempts that were the customer's side, the gift is
 *    refunded.
 *  - A failure that wasn't the customer's side (vehicle breakdown, vendor not
 *    ready, etc.) doesn't count toward the two: it's a rider/logistics
 *    problem, so we simply send it out again.
 *
 * Courier (FEZ) deliveries aren't affected: the courier's own re-attempt
 * policy applies there.
 */

export const GIFT_MAX_CUSTOMER_FAULT_ATTEMPTS = 2;

// Rider-reported reasons (rider-jobs.js INCIDENT_REASONS) that are down to the
// recipient: unreachable, wrong address, or refused.
export const CUSTOMER_FAULT_REASONS = new Set([
  'customer_unreachable',
  'wrong_address',
  'customer_refused',
]);

export function isGiftFulfilmentSubOrder(subOrder) {
  return subOrder?.metadata?.gift_fulfilment === true;
}

/** Counts failed-delivery events per shipment. Returns Map(shipmentId -> {customerFault, total}). */
export async function countFailedAttempts(client, shipmentIds) {
  const counts = new Map();
  const ids = [...new Set((shipmentIds || []).filter(Boolean))];
  if (!ids.length) return counts;

  const { data, error } = await client
    .from('tracking_events')
    .select('shipment_id, metadata')
    .in('shipment_id', ids)
    .eq('status', 'failed');
  if (error) throw error;

  for (const row of data || []) {
    // fail_delivery tags its event metadata.type = 'problem_report'.
    if (row.metadata?.type !== 'problem_report') continue;
    const entry = counts.get(row.shipment_id) || { customerFault: 0, total: 0 };
    entry.total += 1;
    if (CUSTOMER_FAULT_REASONS.has(row.metadata?.reason)) entry.customerFault += 1;
    counts.set(row.shipment_id, entry);
  }
  return counts;
}

export function refundIsDue(customerFaultAttempts) {
  return customerFaultAttempts >= GIFT_MAX_CUSTOMER_FAULT_ATTEMPTS;
}
