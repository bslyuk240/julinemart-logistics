/**
 * Shared zone-resolution + shipping_rates lookup.
 *
 * Extracted from calc-shipping.js's core logic so other call sites (manual
 * shipment pricing, the rider-payout lookup) can reuse the exact same
 * mechanism without duplicating it. Does NOT replace calc-shipping.js's own
 * internal implementation — that stays as-is; this only backs new call
 * sites, so the live customer checkout price path is untouched.
 */

/** Matches calc-shipping.js's zone resolution: case-insensitive match against
 * zones.states, falling back to the first zone if nothing matches. */
export async function resolveZoneForState(supabase, state) {
  const { data: zones, error } = await supabase.from('zones').select('id, code, name, states');
  if (error) throw error;
  if (!zones || zones.length === 0) return null;

  const stateLower = String(state || '').trim().toLowerCase();
  const match = zones.find(
    (z) => Array.isArray(z.states) && z.states.some((s) => String(s).toLowerCase() === stateLower)
  );
  return match || zones[0];
}

/**
 * Best-priority active shipping_rates row for a zone, optionally scoped to a
 * hub and/or a specific courier. Always orders by priority DESC so ties
 * resolve deterministically (see calc-shipping.js's matching fix).
 */
export async function lookupShippingRate(supabase, { zoneId, hubId = null, courierId = null }) {
  let query = supabase
    .from('shipping_rates')
    .select('*, couriers(id, name, code)')
    .eq('zone_id', zoneId)
    .eq('is_active', true)
    .order('priority', { ascending: false })
    .limit(1);

  if (hubId) query = query.eq('hub_id', hubId);
  if (courierId) query = query.eq('courier_id', courierId);

  const { data, error } = await query;
  if (error) throw error;
  return data?.[0] || null;
}

/** Hub-specific rate if one exists for this zone, else the zone-only rate — same fallback calc-shipping.js's hub-based branch already does. */
export async function lookupHubOrZoneRate(supabase, { zoneId, hubId, courierId = null }) {
  const hubRate = await lookupShippingRate(supabase, { zoneId, hubId, courierId });
  if (hubRate) return hubRate;
  return lookupShippingRate(supabase, { zoneId, courierId });
}

export function computeDispatchCost(rate, weight, pickupSurcharge = 0) {
  const baseRate = Number(rate?.flat_rate || 0);
  const perKgRate = Number(rate?.per_kg_rate || 0);
  const cost = baseRate + Number(weight || 0) * perKgRate + Number(pickupSurcharge || 0);
  return Math.round(cost * 100) / 100;
}
