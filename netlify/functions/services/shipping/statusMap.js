/**
 * Map provider statuses onto the existing JLO delivery_status vocabulary.
 * Do not invent a parallel status set — customer, rider, FEZ, and local-rider
 * timelines already share these values.
 */
const JLO_STATUSES = new Set([
  'pending',
  'vendor_dispatched',
  'assigned',
  'pending_pickup',
  'picked_up',
  'in_transit',
  'out_for_delivery',
  'at_hub',
  'delivered',
  'failed',
  'return_required',
  'returning',
  'returned',
  'cancelled',
]);

const SHIPBUBBLE_STATUS_MAP = {
  pending: 'assigned',
  confirmed: 'assigned',
  created: 'assigned',
  booked: 'assigned',
  'pending pick-up': 'pending_pickup',
  'pending pickup': 'pending_pickup',
  assigned: 'assigned',
  'picked-up': 'picked_up',
  picked_up: 'picked_up',
  'picked up': 'picked_up',
  dispatched: 'in_transit',
  in_transit: 'in_transit',
  'in transit': 'in_transit',
  shipped: 'in_transit',
  'out for delivery': 'out_for_delivery',
  out_for_delivery: 'out_for_delivery',
  delivered: 'delivered',
  cancelled: 'cancelled',
  canceled: 'cancelled',
  returned: 'returned',
  // Still on its way back, not finished. Mapping this to 'returned' made the
  // order read as 'refunded' before any money moved.
  'return in progress': 'returning',
  'returning to sender': 'returning',
  failed: 'failed',
  // A failed *delivery attempt*. The courier owns re-attempts under its own
  // policy, so keep the shipment out for delivery: mapping it to 'failed' flips
  // the whole order to cancelled (and releases the voucher) while the courier
  // may still deliver. The raw wording stays on the tracking event. A bare
  // 'failed' (e.g. a booking failure) still maps to 'failed' above.
  'delivery failed': 'out_for_delivery',
  'delivery attempted': 'out_for_delivery',
  'delivery attempt failed': 'out_for_delivery',
  undelivered: 'out_for_delivery',
  'not delivered': 'out_for_delivery',
};

export function mapProviderStatus(provider, rawStatus) {
  if (!rawStatus) return null;
  const value = String(rawStatus).trim();
  if (JLO_STATUSES.has(value)) return value;

  const key = value.toLowerCase();
  if (provider === 'fez') {
    return null;
  }
  return SHIPBUBBLE_STATUS_MAP[key] || null;
}

export function isKnownJloStatus(status) {
  return JLO_STATUSES.has(status);
}
