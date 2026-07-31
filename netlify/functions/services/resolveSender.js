// Shared sender-resolution logic — was duplicated verbatim across
// generate-label.js and fez-create-shipment.js. Also used by
// generate-waybill.js.
//
// Sender address depends on the vendor's collection preference:
// fez_pickup  -> Fez rides to the vendor's shop
// hub_dropoff -> Fez collects from the dispatch hub
//                Sub-hub: parcel has been consolidated at the main hub -> use parent hub
//                Main hub: use this hub's address directly
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

  const senderHub = subOrder.hubs?.is_sub_hub && subOrder.hubs?.parent_hub
    ? subOrder.hubs.parent_hub
    : subOrder.hubs;

  return {
    kind: 'hub',
    name: senderHub?.name || 'JulineMart',
    address: senderHub?.address || '',
    city: senderHub?.city || '',
    state: senderHub?.state || '',
    phone: senderHub?.phone || '',
  };
}
