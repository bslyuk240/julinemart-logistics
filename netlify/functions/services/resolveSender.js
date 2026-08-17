// Shared sender-resolution logic — was duplicated verbatim across
// generate-label.js and fez-create-shipment.js. Also used by
// generate-waybill.js.
//
// Sender address depends on the vendor's collection preference:
// fez_pickup  -> Fez rides to the vendor's shop
// hub_dropoff -> vendor brings the parcel somewhere other than their own
//                shop. Where exactly depends on what's configured for their
//                approved_vendor_locations row, in priority order:
//                  1. A JLO hub (subOrder.hubs) — always the sub-order's OWN
//                     hub, sub-hub included. Sub-hubs have no on-site staff,
//                     so a shipment can still be *created* by staff working
//                     the parent hub's dispatch queue, but Fez physically
//                     visits the sub-hub itself — never substitute the
//                     parent hub's address.
//                  2. A courier hub (approved_vendor_locations.courier_hub_id
//                     -> courier_hubs, or the legacy free-text
//                     fez_hub_name/_address for locations not yet migrated
//                     to the structured picker) — a depot the COURIER runs,
//                     not JulineMart, for vendors outside any JLO hub's
//                     territory but inside a town where that courier has one.
export function resolveSender(subOrder) {
  if (subOrder.vendors?.fez_collection_method === 'fez_pickup') {
    return {
      kind: 'vendor_pickup',
      name: subOrder.vendors.store_name || subOrder.hubs?.name || 'JulineMart',
      address: subOrder.vendors.address || subOrder.hubs?.address || '',
      city: subOrder.vendors.city || '',
      state: subOrder.vendors.state || '',
      phone: subOrder.vendors.phone || subOrder.hubs?.phone || '',
    };
  }

  const senderHub = subOrder.hubs;
  if (senderHub?.name) {
    return {
      kind: 'hub',
      name: senderHub.name,
      address: senderHub.address || '',
      city: senderHub.city || '',
      state: senderHub.state || '',
      phone: senderHub.phone || '',
    };
  }

  const loc = subOrder.vendors?.approved_vendor_locations;
  const courierHub = loc?.courier_hubs;
  if (courierHub?.name) {
    return {
      kind: 'courier_hub',
      name: courierHub.name,
      address: courierHub.address || '',
      city: courierHub.city || subOrder.vendors?.city || '',
      state: courierHub.state || subOrder.vendors?.state || '',
      phone: courierHub.phone || '',
    };
  }
  if (loc?.fez_hub_name || loc?.fez_hub_address) {
    return {
      kind: 'fez_hub',
      name: loc.fez_hub_name || 'Fez Hub',
      address: loc.fez_hub_address || '',
      city: subOrder.vendors?.city || '',
      state: subOrder.vendors?.state || '',
      phone: '',
    };
  }

  return {
    kind: 'hub',
    name: 'JulineMart',
    address: '',
    city: '',
    state: '',
    phone: '',
  };
}
