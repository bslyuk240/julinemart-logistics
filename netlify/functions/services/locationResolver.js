/**
 * Resolves a customer's typed city/LGA against the admin-curated
 * `approved_vendor_locations` table — the single place staff reconcile which
 * LGAs belong to which hub's local-delivery territory (Vendor Locations page).
 *
 * Vendors are already tied to a hub through this same table at approval time
 * (vendors.hub_id is copied from approved_vendor_locations.hub_id — see
 * vendor-approve.js), so resolving the customer's side through it too means
 * vendor, hub, and customer all reconcile against one canonical mapping
 * instead of three independent city strings.
 */
export async function loadApprovedLocations(adminClient) {
  const { data, error } = await adminClient
    .from('approved_vendor_locations')
    .select('id, city, state, lgas, hub_id, supports_local_delivery')
    .eq('status', 'active');

  if (error) {
    console.error('[locationResolver] failed to load approved_vendor_locations:', error.message);
    return [];
  }
  return data || [];
}

/**
 * Match a typed city/LGA against the loaded location rows.
 *
 * Handles two real-world input shapes:
 *  1. City typed correctly ("Warri"), LGA optionally selected ("Effurun") —
 *     matches the row whose `city` equals the input and whose `lgas[]`
 *     contains the LGA (or has none listed, treated as city-wide).
 *  2. An LGA typed into the free-text city field instead of the city itself
 *     ("Effurun" typed as city, no separate LGA given) — falls back to
 *     searching every row's `lgas[]` for that value.
 */
export function resolveApprovedLocation(locations, city, lga) {
  const normCity = String(city || '').trim().toLowerCase();
  const normLga = String(lga || '').trim().toLowerCase();
  if (!normCity && !normLga) return null;

  const rows = Array.isArray(locations) ? locations : [];

  const direct = rows.find((r) => {
    if (String(r.city || '').trim().toLowerCase() !== normCity) return false;
    if (!normLga) return true;
    const lgas = (Array.isArray(r.lgas) ? r.lgas : []).map((x) => String(x).trim().toLowerCase());
    return lgas.length === 0 || lgas.includes(normLga);
  });
  if (direct) return direct;

  const probe = normLga || normCity;
  if (!probe) return null;

  return (
    rows.find((r) => {
      const lgas = (Array.isArray(r.lgas) ? r.lgas : []).map((x) => String(x).trim().toLowerCase());
      return lgas.includes(probe);
    }) || null
  );
}
