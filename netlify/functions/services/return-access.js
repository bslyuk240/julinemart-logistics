/**
 * Ownership checks for customer-facing return endpoints.
 *
 * A customer may only see or update a return that belongs to them. "Not found"
 * and "not yours" are indistinguishable to the caller, so ids can't be probed.
 */

const sameEmail = (a, b) =>
  String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

/** The return request, if it exists and belongs to `email`; otherwise null. */
export async function loadOwnedReturnRequest(client, returnRequestId, email) {
  if (!returnRequestId) return null;
  const { data, error } = await client
    .from('return_requests')
    .select('id, customer_email')
    .eq('id', returnRequestId)
    .maybeSingle();
  if (error || !data) return null;
  return sameEmail(data.customer_email, email) ? data : null;
}

/** The return shipment, if its return request belongs to `email`; otherwise null. */
export async function loadOwnedReturnShipment(client, returnShipmentId, email) {
  if (!returnShipmentId) return null;
  const { data, error } = await client
    .from('return_shipments')
    .select('id, return_request_id')
    .eq('id', returnShipmentId)
    .maybeSingle();
  if (error || !data) return null;
  const owned = await loadOwnedReturnRequest(client, data.return_request_id, email);
  return owned ? data : null;
}
