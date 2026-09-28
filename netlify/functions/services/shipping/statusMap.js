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
  'return in progress': 'returned',
  failed: 'failed',
  'delivery failed': 'failed',
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
