/**
 * When may a customer still cancel a paid order?
 *
 * Rule: until delivery has been arranged, meaning a courier shipment has been
 * created or a local rider has been assigned (or the parcel has already moved).
 * Both FEZ shipment creation and rider assignment flip the sub-order out of
 * 'pending', and also write courier_shipment_id / courier_waybill /
 * assigned_rider_id, so we check the status and those fields.
 *
 * The old rule only blocked from 'picked_up' onward, which let customers cancel
 * and be fully refunded after a courier trip had already been booked.
 */

// Before any shipment exists. 'processing' is the vendor preparing the order.
const PRE_SHIPMENT_STATUSES = new Set(['pending', 'processing']);

export function isDeliveryArranged(subOrder) {
  if (!subOrder) return false;
  if (subOrder.status && !PRE_SHIPMENT_STATUSES.has(subOrder.status)) return true;
  return Boolean(subOrder.courier_shipment_id || subOrder.courier_waybill || subOrder.assigned_rider_id);
}

/** Returns the first sub-order whose delivery is already arranged, or null. */
export function findArrangedShipment(subOrders) {
  return (subOrders || []).find(isDeliveryArranged) || null;
}
