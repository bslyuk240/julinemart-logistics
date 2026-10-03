import { isCarrierPickupEnabled } from './return-pickup.js';

/**
 * One customer-facing shape for a return, used by returns-list,
 * returns-by-order and get-order-returns, so every storefront screen reads the
 * same fields (the PWA's JloReturn type).
 *
 * `req` is a return_requests row with its return_shipments embedded (an array,
 * or a single object depending on how PostgREST sees the relationship).
 */
export function formatReturnForCustomer(req) {
  const shipments = Array.isArray(req.return_shipments)
    ? req.return_shipments
    : req.return_shipments
    ? [req.return_shipments]
    : [];
  const shipment = shipments[0] || null;

  const method = req.fez_method === 'pickup' ? 'pickup' : 'dropoff';
  const trackingNumber = shipment?.fez_tracking || null;

  return {
    return_request_id: req.id,
    return_shipment_id: shipment?.id,
    order_id: req.order_id,
    order_number: req.order_number,
    status: req.status,
    method,
    hub_id: req.hub_id,
    reason_code: req.reason_code,
    reason_note: req.reason_note,
    complaint_type: req.complaint_type,
    preferred_resolution: req.preferred_resolution,
    images: req.images || [],
    created_at: req.created_at,
    resolution_timeline: req.resolution_timeline || [],

    // Shipment info. tracking_url is a courier's own tracking page (e.g.
    // Shipbubble), used when there is no Fez tracking number.
    return_code: shipment?.return_code || null,
    tracking_number: trackingNumber,
    tracking_url: shipment?.tracking_url || null,
    tracking_submitted_at: shipment?.tracking_submitted_at || null,
    return_shipment: shipment
      ? {
          return_shipment_id: shipment.id,
          return_request_id: req.id,
          return_code: shipment.return_code || null,
          tracking_number: trackingNumber,
          tracking_url: shipment.tracking_url || null,
          status: shipment.status,
          tracking_submitted_at: shipment.tracking_submitted_at || null,
        }
      : undefined,

    // Refund info for the customer's own return
    refund_status: req.refund_status || 'none',
    refund_amount: req.refund_amount ?? undefined,
    refund_currency: req.refund_currency || undefined,
    refund_method: req.refund_method || undefined,
    refund_completed_at: req.refund_completed_at || undefined,
    refund_initiated_at: req.refund_initiated_at || undefined,
    refund_expected_by: req.refund_expected_by || undefined,

    // Pickup (only present for pickup returns, once the migration is applied)
    pickup: method === 'pickup' ? req.pickup || null : null,
    pickup_fee: method === 'pickup' ? Number(req.pickup_fee || 0) : 0,
    pickup_lane: method === 'pickup' ? req.pickup_lane || null : null,
  };
}

/**
 * What every customer-facing return lookup selects. The courier columns come
 * from the carrier-pickup migration, so they're only requested once they exist
 * (otherwise these lookups would fail on a database that doesn't have them yet).
 */
export async function returnSelect(client) {
  const courierCols = (await isCarrierPickupEnabled(client)) ? 'provider, tracking_url,' : '';
  return `
  *,
  return_shipments (
    ${courierCols}
    id,
    return_code,
    status,
    fez_tracking,
    tracking_submitted_at,
    method
  )
`;
}
