/** Vendor fulfilment routing — JLO hub area vs Fez-only locations. */

export type VendorFulfillmentContext = {
  isJloHubVendor: boolean;
  collectionMethod: 'fez_pickup' | 'hub_dropoff';
  hubName: string | null;
  hubAddress: string | null;
  sentToHubAction: boolean;
  showFezCollectionSettings: boolean;
};

type VendorLike = {
  hub_id?: string | null;
  city?: string | null;
  state?: string | null;
  fez_collection_method?: 'fez_pickup' | 'hub_dropoff' | null;
  fulfillment_context?: VendorFulfillmentContext | null;
  hub?: { name?: string | null; address?: string | null; city?: string | null } | null;
  approved_vendor_locations?: {
    fez_hub_name?: string | null;
    fez_hub_address?: string | null;
    hubs?: { name?: string | null; address?: string | null; city?: string | null } | null;
  } | null;
};

export function resolveVendorFulfillment(vendor: VendorLike | null): VendorFulfillmentContext {
  if (vendor?.fulfillment_context) return vendor.fulfillment_context;

  const loc = vendor?.approved_vendor_locations;
  const jloHub = loc?.hubs || vendor?.hub || null;
  const isJloHubVendor = Boolean(jloHub?.name || vendor?.hub_id);
  const collectionMethod = vendor?.fez_collection_method || 'hub_dropoff';
  const hubName = jloHub?.name || loc?.fez_hub_name || null;
  const hubAddress = jloHub
    ? `${jloHub.address || ''}${jloHub.city ? `, ${jloHub.city}` : ''}`.replace(/^,\s*/, '')
    : loc?.fez_hub_address || null;

  return {
    isJloHubVendor,
    collectionMethod,
    hubName,
    hubAddress,
    sentToHubAction: isJloHubVendor && collectionMethod === 'hub_dropoff',
    showFezCollectionSettings: !isJloHubVendor,
  };
}

export function isRealShipmentTracking(value?: string | null) {
  if (!value || typeof value !== 'string') return false;
  const lower = value.toLowerCase();
  return !['error', 'cannot', 'failed', 'jlo-', 'cr-'].some((b) => lower.includes(b));
}
