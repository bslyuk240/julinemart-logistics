/**
 * Shared shipment -> rider-facing-shape summarization, extracted out of
 * rider-jobs.js so rider-activity.js's detail view can reuse the exact same
 * pickup/dropoff resolution (vendor address, hub fallback, manual_shipment
 * sender/recipient) instead of re-deriving it.
 */
import { resolveSender } from './resolveSender.js';

export function isAccepted(metadata) {
  return Boolean(metadata && typeof metadata === 'object' && metadata.rider_accepted_at);
}

// resolveSender() distinguishes vendor_pickup/hub/courier_hub/fez_hub for
// internal routing (see resolveSender.js) — riders don't need that level of
// detail, just whether they're collecting from the vendor's own shop or
// some kind of hub/depot. "Vendor" was being shown for every pickup
// regardless of actual source; this is what lets the client show the right
// word instead.
function pickupKindFor(resolveSenderKind) {
  return resolveSenderKind === 'vendor_pickup' ? 'vendor' : 'hub';
}

// shipments carries the shared dispatch fields (status, tracking, courier,
// rider, timestamps) for both sub_orders and manual_shipments — see
// shipmentSync.js.
export const SHIPMENT_LIST_SELECT =
  'id, source_type, sub_order_id, manual_shipment_id, status, tracking_number, metadata, delivery_proof_url, signature_url, picked_up_at, out_for_delivery_at, delivered_at, failed_at, created_at, rider_payout, rider_payout_breakdown';

// Orders/shipments at or above this value require a customer signature in
// addition to the delivery photo (brief's "verified" Proof of Delivery
// level — "high_value" and its extra requirements aren't built yet).
export const POD_VERIFIED_THRESHOLD_NGN = 50000;

export function podLevelForValue(value) {
  return (Number(value) || 0) >= POD_VERIFIED_THRESHOLD_NGN ? 'verified' : 'standard';
}

// hubs(...) here is the sub_order's OWN hub_id join — used both for the
// pre-existing hub-fallback pickup case (hub as sender) and, when
// metadata.rider_leg === 'to_hub' (see rider-jobs.js), as the DESTINATION
// for a first-mile rider leg instead of the customer.
const SUB_ORDER_DETAIL_SELECT = `
  id, main_order_id, subtotal, allocated_shipping_fee, courier_charge,
  vendors ( store_name, address, city, state, phone, fez_collection_method,
    approved_vendor_locations ( fez_hub_name, fez_hub_address, courier_hubs ( name, address, city, state, phone ) ) ),
  hubs ( name, address, city, state, phone ),
  orders:main_order_id ( id, order_number, customer_name, customer_phone, customer_email,
    delivery_address, delivery_city, delivery_state, delivery_landmark, metadata )
`;

export async function fetchSourceDetails(adminClient, shipmentRows) {
  const subOrderIds = shipmentRows.filter((s) => s.source_type === 'sub_order').map((s) => s.sub_order_id);
  const manualIds = shipmentRows.filter((s) => s.source_type === 'manual_shipment').map((s) => s.manual_shipment_id);

  const [subOrdersRes, manualRes] = await Promise.all([
    subOrderIds.length
      ? adminClient.from('sub_orders').select(SUB_ORDER_DETAIL_SELECT).in('id', subOrderIds)
      : Promise.resolve({ data: [] }),
    manualIds.length
      ? adminClient
          .from('manual_shipments')
          .select('id, sender, sender_hub_id, recipient, item_description, item_value, destination_hub:destination_hub_id ( name, address, city, state, phone )')
          .in('id', manualIds)
      : Promise.resolve({ data: [] }),
  ]);

  return {
    subOrderMap: new Map((subOrdersRes.data || []).map((r) => [r.id, r])),
    manualMap: new Map((manualRes.data || []).map((r) => [r.id, r])),
  };
}

export function summarizeShipment(s, subOrderMap, manualMap) {
  const base = {
    id: s.id,
    tracking_number: s.tracking_number,
    status: s.status,
    accepted: isAccepted(s.metadata),
    delivery_proof_url: s.delivery_proof_url || null,
    signature_url: s.signature_url || null,
    // Frozen at assign/broadcast time (see assign-rider.js et al.) — null for
    // any shipment dispatched before this existed, or where the zone/rate
    // lookup failed and rider_payout itself fell back to the legacy full-fee
    // value. The client only shows a breakdown section when this is present.
    fee_breakdown: s.rider_payout_breakdown || null,
    assigned_at: s.created_at,
    picked_up_at: s.picked_up_at,
    out_for_delivery_at: s.out_for_delivery_at,
    delivered_at: s.delivered_at,
    failed_at: s.failed_at || null,
  };

  // First-mile leg (rider-jobs.js's advance/claim honor this the same way)
  // — the rider's destination is a JLO hub, not the customer/recipient.
  // dropoff keeps its usual shape (customer_name/address/city/state) so
  // every existing consumer of this summary renders it without changes;
  // the values underneath just point at the hub instead.
  const isHubLeg = s.metadata?.rider_leg === 'to_hub';

  if (s.source_type === 'sub_order') {
    const subOrder = subOrderMap.get(s.sub_order_id);
    if (!subOrder) return null;
    const pickup = resolveSender(subOrder);
    const order = subOrder.orders || {};
    const hub = subOrder.hubs || {};
    return {
      ...base,
      // rider_payout is the commission-adjusted amount, frozen at
      // assign/broadcast time — this is what the rider actually earns, not
      // the customer's full shipping fee. Falls back to the old full-fee
      // read only for shipments assigned before rider_payout existed.
      fee: s.rider_payout ?? (Number(subOrder.allocated_shipping_fee ?? subOrder.courier_charge ?? 0) || 0),
      order_number: order.order_number || null,
      pod_level: podLevelForValue(subOrder.subtotal),
      pickup: {
        name: pickup.name,
        address: pickup.address,
        city: pickup.city,
        state: pickup.state,
        phone: pickup.phone,
        kind: pickupKindFor(pickup.kind),
      },
      dropoff: isHubLeg
        ? {
            customer_name: hub.name ? `Hub: ${hub.name}` : 'Hub',
            customer_phone: hub.phone || null,
            address: hub.address || null,
            city: hub.city || null,
            state: hub.state || null,
            landmark: null,
            kind: 'hub',
          }
        : {
            customer_name: order.customer_name || null,
            customer_phone: order.customer_phone || null,
            address: order.delivery_address || null,
            city: order.delivery_city || null,
            state: order.delivery_state || null,
            landmark: order.delivery_landmark || null,
          },
    };
  }

  // manual_shipment — rider_payout is only populated for shipments assigned
  // after that field existed; older ones still show 0 (same as before).
  // sender/recipient are already {name, address, city, state, phone}
  // shaped, matching the sub_order pickup/dropoff shape.
  const manual = manualMap.get(s.manual_shipment_id);
  if (!manual) return null;
  const sender = manual.sender || {};
  const recipient = manual.recipient || {};
  const destinationHub = manual.destination_hub || {};
  return {
    ...base,
    fee: s.rider_payout ?? 0,
    order_number: null,
    pod_level: podLevelForValue(manual.item_value),
    pickup: {
      name: sender.name || null,
      address: sender.address || null,
      city: sender.city || null,
      state: sender.state || null,
      phone: sender.phone || null,
      kind: manual.sender_hub_id ? 'hub' : 'sender',
    },
    dropoff: isHubLeg
      ? {
          customer_name: destinationHub.name ? `Hub: ${destinationHub.name}` : 'Hub',
          customer_phone: destinationHub.phone || null,
          address: destinationHub.address || null,
          city: destinationHub.city || null,
          state: destinationHub.state || null,
          landmark: null,
          kind: 'hub',
        }
      : {
          customer_name: recipient.name || null,
          customer_phone: recipient.phone || null,
          address: recipient.address || null,
          city: recipient.city || null,
          state: recipient.state || null,
          landmark: null,
        },
  };
}
