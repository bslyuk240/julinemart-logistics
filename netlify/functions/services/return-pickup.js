/**
 * Return pickup: rules shared by returns-create, the quote endpoint, approval
 * and the returns queue.
 *
 * Policy (decided by the owner):
 *  - JulineMart pays for the pickup when the return is its fault: damaged,
 *    wrong item, not as described (operational faults).
 *  - The customer pays when it's their fault or they simply want to return
 *    it. The fee is quoted up front and staff deduct it from the refund.
 *  - Drop-off stays available and free.
 *  - Local riders do pickups within the hub's own town; Fez does the rest.
 */
import { firstDeliveryError, validateDeliveryDetails } from './deliveryDetails.js';
import { computeDispatchCost, lookupShippingRate, resolveZoneForState } from './shippingRateLookup.js';

/** reason_code values (set by returns-create) where JulineMart is at fault. */
export const OUR_FAULT_REASON_CODES = new Set(['damaged', 'wrong_item', 'not_as_described']);

/**
 * The storefront sends a finer-grained complaint type, but maps several of
 * them to reason_code 'other'. "Missing items" and "suspected counterfeit" are
 * operational faults too, so the complaint type counts as well; otherwise a
 * customer with an incomplete or fake item would be charged for the pickup.
 */
export const OUR_FAULT_COMPLAINT_TYPES = new Set([
  'wrong_product',
  'damaged',
  'not_as_described',
  'missing_items',
  'suspected_counterfeit',
  'not_received',
]);

const norm = (v) => String(v || '').trim().toLowerCase();

export function isOurFault(reasonCode, complaintType) {
  return OUR_FAULT_REASON_CODES.has(norm(reasonCode)) || OUR_FAULT_COMPLAINT_TYPES.has(norm(complaintType));
}

const sameText = (a, b) =>
  String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

// The pickup columns come from a migration. Until it is applied, pickup is
// switched off instead of every return request failing on a missing column.
let enabledCache = { value: null, checkedAt: 0 };
const RECHECK_DISABLED_MS = 60 * 1000;

export async function isPickupEnabled(client) {
  if (enabledCache.value === true) return true;
  if (enabledCache.value === false && Date.now() - enabledCache.checkedAt < RECHECK_DISABLED_MS) {
    return false;
  }
  const { error } = await client
    .from('return_requests')
    .select('pickup, pickup_fee, pickup_lane')
    .limit(1);
  enabledCache = { value: !error, checkedAt: Date.now() };
  return !error;
}

/** Test hook: forget the cached availability check. */
export function resetPickupEnabledCache() {
  enabledCache = { value: null, checkedAt: 0 };
}

/**
 * What would collecting a package from this state cost? Uses the same
 * zone-rate lookup that prices a manual shipment from a sender's address.
 * Returns null when no rate is configured for the zone.
 */
export async function quotePickupFee(client, { state, weight = 1 }) {
  const zone = await resolveZoneForState(client, state);
  if (!zone) return null;
  const rate = await lookupShippingRate(client, { zoneId: zone.id });
  if (!rate) return null;
  return { fee: computeDispatchCost(rate, weight), zone_id: zone.id };
}

/**
 * The charge for a pickup. `fee` is what the customer owes (0 when it's our
 * fault); `quoted_fee` is the real cost either way, for display and records.
 */
export async function pickupChargeFor(client, { reasonCode, complaintType, state, weight = 1 }) {
  const quote = await quotePickupFee(client, { state, weight });
  if (!quote) return { available: false, free: false, fee: 0, quoted_fee: null };
  const free = isOurFault(reasonCode, complaintType);
  return { available: true, free, fee: free ? 0 : quote.fee, quoted_fee: quote.fee };
}

function todayInLagos() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  return parts; // YYYY-MM-DD
}

function addDays(isoDate, days) {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const MAX_PICKUP_DAYS_AHEAD = 14;

/** Validates and normalises the pickup details a customer submits. */
export function validatePickupDetails(input = {}) {
  const check = validateDeliveryDetails({
    name: input.name,
    phone: input.phone,
    address: input.address,
    city: input.city,
    state: input.state,
    requireEmail: false,
    nameLabel: 'Contact name',
  });
  if (!check.ok) return { ok: false, error: firstDeliveryError(check) };

  let preferredDate = String(input.preferred_date || '').trim() || null;
  if (preferredDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(preferredDate) || Number.isNaN(Date.parse(preferredDate))) {
      return { ok: false, error: 'Preferred pickup date is not a valid date' };
    }
    const today = todayInLagos();
    if (preferredDate < today) return { ok: false, error: 'Preferred pickup date cannot be in the past' };
    if (preferredDate > addDays(today, MAX_PICKUP_DAYS_AHEAD)) {
      return { ok: false, error: `Preferred pickup date must be within ${MAX_PICKUP_DAYS_AHEAD} days` };
    }
  }

  return {
    ok: true,
    value: {
      name: check.normalized.name,
      phone: check.normalized.phone,
      address: check.normalized.address,
      city: check.normalized.city,
      state: check.normalized.state,
      preferred_date: preferredDate,
      notes: String(input.notes || '').trim().slice(0, 300) || null,
    },
  };
}

/** A local rider covers pickups in the hub's own town; everywhere else is Fez. */
export function chooseReturnLane({ pickupCity, hubCity }) {
  return pickupCity && hubCity && sameText(pickupCity, hubCity) ? 'local_rider' : 'fez';
}

/**
 * The hub a pickup should come back to: same town, else same state, else any.
 * Customers aren't asked to choose; they may not know where the hubs are.
 */
export async function resolveReturnHub(client, { city, state }) {
  const { data: hubs, error } = await client
    .from('hubs')
    .select('id, name, address, city, state, phone');
  if (error) throw error;
  if (!hubs?.length) return null;
  return (
    hubs.find((h) => sameText(h.city, city) && sameText(h.state, state)) ||
    hubs.find((h) => sameText(h.state, state)) ||
    hubs[0]
  );
}
