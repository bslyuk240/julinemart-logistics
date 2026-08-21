/**
 * Shipment entity unification — dual-write bridge, phase 1.
 *
 * sub_orders and manual_shipments stay the source of truth for their own
 * dispatch fields during the transition; this mirrors every write into the
 * shared `shipments` table so it stays current. Once every consumer
 * (rider-jobs.js, the dashboard's rider picker, etc.) reads from
 * `shipments` directly, this sync goes away and the old columns get
 * dropped — but that's a later, separate step.
 *
 * Deliberately best-effort: a sync failure here must never break the
 * actual dispatch write it's mirroring. Callers should not await this in
 * a way that fails the request — call it, but don't let its rejection
 * propagate past a caught/logged failure.
 */

function metadataForShipment(fields) {
  if (!fields.metadata || typeof fields.metadata !== 'object') return undefined;
  const { selected_lane, eligible_lanes, rider_accepted_at, declined_by, rider_leg } = fields.metadata;
  const picked = {};
  if (selected_lane !== undefined) picked.selected_lane = selected_lane;
  if (eligible_lanes !== undefined) picked.eligible_lanes = eligible_lanes;
  if (rider_accepted_at !== undefined) picked.rider_accepted_at = rider_accepted_at;
  if (declined_by !== undefined) picked.declined_by = declined_by;
  // rider_leg ('to_hub' | null) is what rider-jobs.js's summarizeShipment
  // reads (from THIS shipments table, not the source table) to decide
  // whether to show the destination hub or the recipient as dropoff — an
  // omission here silently showed every hub-leg job as a normal delivery.
  if (rider_leg !== undefined) picked.rider_leg = rider_leg;
  return picked;
}

/**
 * @param {object} adminClient - Supabase service-role client
 * @param {object} opts
 * @param {string} [opts.subOrderId]
 * @param {string} [opts.manualShipmentId]
 * @param {object} opts.fields - any subset of the shared dispatch columns
 *   (courier_id, assigned_rider_id, status, tracking_number, waybill_number,
 *   courier_shipment_id, courier_tracking_url, courier_waybill,
 *   delivery_person_name/phone/vehicle, delivery_proof_url, picked_up_at,
 *   out_for_delivery_at, delivered_at, failed_at, last_tracking_update,
 *   metadata - only the dispatch-relevant keys are mirrored, see above)
 */
export async function syncShipment(adminClient, { subOrderId, manualShipmentId, fields }) {
  if (!subOrderId && !manualShipmentId) return;

  const matchColumn = subOrderId ? 'sub_order_id' : 'manual_shipment_id';
  const matchValue = subOrderId || manualShipmentId;

  const { data: existing, error: lookupError } = await adminClient
    .from('shipments')
    .select('id, metadata')
    .eq(matchColumn, matchValue)
    .maybeSingle();

  if (lookupError) throw lookupError;

  const { metadata: rawMetadata, ...rest } = fields;
  const payload = { ...rest, updated_at: new Date().toISOString() };
  const metadataPatch = metadataForShipment(fields);

  if (existing) {
    if (metadataPatch) payload.metadata = { ...(existing.metadata || {}), ...metadataPatch };
    const { error } = await adminClient.from('shipments').update(payload).eq('id', existing.id);
    if (error) throw error;
    return;
  }

  const { error } = await adminClient.from('shipments').insert({
    source_type: subOrderId ? 'sub_order' : 'manual_shipment',
    sub_order_id: subOrderId || null,
    manual_shipment_id: manualShipmentId || null,
    metadata: metadataPatch || {},
    ...payload,
  });
  if (error) throw error;
}

/** Fire-and-log a sync so it never fails the caller's actual request. */
export function syncShipmentBestEffort(adminClient, opts, label) {
  return syncShipment(adminClient, opts).catch((err) => {
    console.error(`shipmentSync (${label}) failed:`, err?.message || err);
  });
}
