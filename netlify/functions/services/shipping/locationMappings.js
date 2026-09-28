import { createHash } from 'node:crypto';

export function locationKeyForOrigin(subOrder, sender) {
  if (subOrder.vendors?.approved_location_id) {
    return `vendor_loc:${subOrder.vendors.approved_location_id}`;
  }
  if (subOrder.hub_id) return `hub:${subOrder.hub_id}`;
  if (subOrder.vendors?.id) return `vendor:${subOrder.vendors.id}`;
  return `origin:${hashAddress(sender?.address, sender?.city, sender?.state)}`;
}

export function locationKeyForDestination(order) {
  return `dest:${hashAddress(order?.delivery_address, order?.delivery_city, order?.delivery_state)}`;
}

export function hashAddress(...parts) {
  return createHash('sha256')
    .update(parts.map((p) => String(p || '').trim().toLowerCase()).join('|'))
    .digest('hex')
    .slice(0, 24);
}

export async function getMappedAddressCode(supabase, locationKey, provider) {
  const { data } = await supabase
    .from('provider_location_mappings')
    .select('provider_address_code, provider_location_id, metadata')
    .eq('location_key', locationKey)
    .eq('provider', provider)
    .maybeSingle();
  return data || null;
}

export async function saveMappedAddressCode(supabase, {
  locationKey,
  provider,
  addressCode,
  locationId = null,
  metadata = {},
}) {
  const { error } = await supabase.from('provider_location_mappings').upsert({
    location_key: locationKey,
    provider,
    provider_address_code: addressCode == null ? null : String(addressCode),
    provider_location_id: locationId,
    metadata,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'location_key,provider' });
  if (error) console.warn('[locationMappings] upsert failed:', error.message);
}
