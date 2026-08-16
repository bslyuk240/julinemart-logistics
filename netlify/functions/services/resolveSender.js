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
//                  2. A Fez hub (approved_vendor_locations.fez_hub_name/
//                     _address) — Fez's own depot, not one JulineMart runs,
//                     for vendors outside any JLO hub's territory but inside
//                     a town where Fez has a depot.
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

  const fezHub = subOrder.vendors?.approved_vendor_locations;
  if (fezHub?.fez_hub_name || fezHub?.fez_hub_address) {
    return {
      kind: 'fez_hub',
      name: fezHub.fez_hub_name || 'Fez Hub',
      address: fezHub.fez_hub_address || '',
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
