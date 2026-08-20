/**
 * JLO tracking-number and waybill-number generation for local-rider
 * dispatch — extracted from assign-rider.js and manual-shipment-assign-
 * rider.js, which had this exact logic duplicated verbatim. Also used by
 * rider-jobs.js's handleClaim (broadcast claim), which previously generated
 * neither — a claimed shipment could end up with no tracking_number and no
 * waybill_number at all, since direct-assign was the only path that ever
 * called this.
 */

export function generateJloTracking() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let value = 'JLO-';
  for (let i = 0; i < 8; i++) {
    value += chars[Math.floor(Math.random() * chars.length)];
  }
  return value;
}

export function shouldGenerateLocalTracking(value) {
  if (!value || typeof value !== 'string') return true;
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (/^(FEZ|CR)-/i.test(trimmed)) return true;
  if (/^[0-9a-f-]{36}$/i.test(trimmed)) return true;
  if (/error|cannot|failed|invalid|wrong|already exists/i.test(trimmed)) return true;
  return false;
}

/**
 * Returns the tracking number to write (existing one kept if it's already a
 * real local-rider code, otherwise a fresh JLO-XXXXXXXX) and a waybill
 * number (existing one kept, or a fresh one from the next_waybill_number()
 * sequence). Waybill generation is non-fatal on failure — dispatch/claim
 * must not be blocked by it; generate-waybill.js's ensureWaybillNumber()
 * self-heals a number the first time anyone views/prints the waybill.
 */
export async function ensureTrackingAndWaybill(supabase, { trackingNumber, waybillNumber }) {
  const nextTrackingNumber = shouldGenerateLocalTracking(trackingNumber) ? generateJloTracking() : trackingNumber;

  let nextWaybillNumber = waybillNumber || null;
  if (!nextWaybillNumber) {
    const { data, error } = await supabase.rpc('next_waybill_number');
    if (error) {
      console.error('waybill number generation failed:', error);
    } else {
      nextWaybillNumber = data;
    }
  }

  return { trackingNumber: nextTrackingNumber, waybillNumber: nextWaybillNumber };
}
