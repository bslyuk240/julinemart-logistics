/**
 * Resolve whether a vendor is in a JLO hub service area.
 * Falls back to city/state match when hub_id / approved_location_id were never set.
 */

const STATE_ALIASES = {
  de: 'delta',
  delta: 'delta',
  la: 'lagos',
  lagos: 'lagos',
  ab: 'abia',
  abia: 'abia',
  ri: 'rivers',
  rivers: 'rivers',
  ed: 'edo',
  edo: 'edo',
};

function normalizeState(value) {
  if (!value) return '';
  const key = String(value).trim().toLowerCase();
  return STATE_ALIASES[key] || key;
}

function normalizeCity(value) {
  return String(value || '').trim().toLowerCase();
}

function formatHubAddress(hub) {
  if (!hub) return null;
  return `${hub.address || ''}${hub.city ? `, ${hub.city}` : ''}`.replace(/^,\s*/, '') || null;
}

async function findLocationByCityState(adminClient, city, state) {
  const normCity = normalizeCity(city);
  const normState = normalizeState(state);
  if (!normCity || !normState) return null;

  const { data: rows } = await adminClient
    .from('approved_vendor_locations')
    .select(
      'id, hub_id, city, state, fez_hub_name, fez_hub_address, supports_vendor_to_hub, hubs ( name, address, city )',
    )
    .eq('status', 'active')
    .not('hub_id', 'is', null);

  return (
    (rows || []).find(
      (row) => normalizeCity(row.city) === normCity && normalizeState(row.state) === normState,
    ) || null
  );
}

export async function enrichVendorProfile(adminClient, vendor) {
  const { data: fullVendor, error } = await adminClient
    .from('vendors')
    .select(
      '*, hub:hubs!hub_id ( id, name, address, city ), approved_vendor_locations ( id, hub_id, fez_hub_name, fez_hub_address, vendor_pickup_surcharge, supports_vendor_to_hub, hubs ( name, address, city ) )',
    )
    .eq('id', vendor.id)
    .single();

  if (error || !fullVendor) return { vendor, fulfillment_context: buildFulfillmentContext(vendor) };

  let row = fullVendor;
  let matchedLocation = fullVendor.approved_vendor_locations;

  const jloHubFromJoin = matchedLocation?.hubs || fullVendor.hub;
  if (!jloHubFromJoin?.name && !fullVendor.hub_id) {
    matchedLocation = await findLocationByCityState(adminClient, fullVendor.city, fullVendor.state);
    if (matchedLocation) {
      row = {
        ...fullVendor,
        approved_vendor_locations: matchedLocation,
        hub_id: fullVendor.hub_id || matchedLocation.hub_id,
        hub: matchedLocation.hubs || fullVendor.hub,
      };

      // Backfill missing links so future reads are fast and accurate
      if (!fullVendor.hub_id || !fullVendor.approved_location_id) {
        await adminClient
          .from('vendors')
          .update({
            hub_id: matchedLocation.hub_id,
            approved_location_id: fullVendor.approved_location_id || matchedLocation.id,
            updated_at: new Date().toISOString(),
          })
          .eq('id', fullVendor.id);
      }
    }
  }

  const fulfillment_context = buildFulfillmentContext(row);
  return { vendor: { ...row, fulfillment_context }, fulfillment_context };
}

export function buildFulfillmentContext(vendor) {
  const loc = vendor?.approved_vendor_locations;
  const jloHub = loc?.hubs || vendor?.hub || null;
  const isJloHubVendor = Boolean(jloHub?.name || vendor?.hub_id);
  const collectionMethod = vendor?.fez_collection_method || 'hub_dropoff';
  const hubName = jloHub?.name || loc?.fez_hub_name || null;
  const hubAddress = jloHub ? formatHubAddress(jloHub) : loc?.fez_hub_address || null;

  return {
    isJloHubVendor,
    collectionMethod,
    hubName,
    hubAddress,
    sentToHubAction: isJloHubVendor && collectionMethod === 'hub_dropoff',
    showFezCollectionSettings: !isJloHubVendor,
  };
}
