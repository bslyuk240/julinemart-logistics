/**
 * Keeps a return in step with its pickup.
 *
 * Two pickups report progress back here:
 *  - a local rider moves a manual shipment: picked up from the customer, then
 *    dropped at the hub (at_hub); rider-jobs calls syncReturnPickupProgress.
 *  - a Shipbubble courier reports through its webhook;
 *    shipping-webhook-shipbubble calls syncReturnPickupCarrier.
 * Both map to the milestones the return shows the customer and staff: in
 * transit, then delivered to hub. Best-effort: a failure here must never undo
 * or block the rider's or the webhook's own status change.
 */
const STEPS = {
  in_transit: { status: 'in_transit', label: 'Picked up from customer', stage: 'pickup_collected' },
  delivered_to_hub: { status: 'delivered_to_hub', label: 'Delivered to hub', stage: 'delivered_to_hub' },
};

async function applyStep(client, returnShipment, step, actor) {
  if (returnShipment.status === step.status) return false;

  await client.from('return_shipments').update({ status: step.status }).eq('id', returnShipment.id);
  await appendTimeline(client, returnShipment.return_request_id, {
    status: step.status,
    entry: { stage: step.stage, label: step.label, actor },
  });
  return true;
}

async function appendTimeline(client, returnRequestId, { status, entry }) {
  if (!returnRequestId) return;
  const { data: request } = await client
    .from('return_requests')
    .select('id, status, resolution_timeline')
    .eq('id', returnRequestId)
    .maybeSingle();
  if (!request) return;
  const timeline = Array.isArray(request.resolution_timeline) ? [...request.resolution_timeline] : [];
  timeline.push({ at: new Date().toISOString(), ...entry });
  await client
    .from('return_requests')
    .update({ ...(status ? { status } : {}), resolution_timeline: timeline })
    .eq('id', request.id);
}

const RIDER_STATUS_TO_STEP = { picked_up: STEPS.in_transit, at_hub: STEPS.delivered_to_hub };

/** Local rider: manual shipment status -> return status. */
export async function syncReturnPickupProgress(client, manualShipmentId, riderStatus) {
  const step = RIDER_STATUS_TO_STEP[riderStatus];
  if (!step || !manualShipmentId) return false;

  const { data: returnShipment, error } = await client
    .from('return_shipments')
    .select('id, return_request_id, status')
    .eq('manual_shipment_id', manualShipmentId)
    .maybeSingle();
  // No row (or the migration isn't applied): this manual shipment isn't a
  // return pickup, which is the normal case. Nothing to do.
  if (error || !returnShipment) return false;
  return applyStep(client, returnShipment, step, 'rider');
}

const CARRIER_STATUS_TO_STEP = {
  picked_up: STEPS.in_transit,
  in_transit: STEPS.in_transit,
  out_for_delivery: STEPS.in_transit,
  delivered: STEPS.delivered_to_hub,
  at_hub: STEPS.delivered_to_hub,
};

// Statuses that don't change the return but that staff should see: the
// courier cancelled or couldn't complete the collection.
const CARRIER_EXCEPTIONS = new Set(['cancelled', 'failed']);

/**
 * Shipbubble courier: a webhook status (already mapped to JLO's vocabulary)
 * -> return status. Returns true if it matched a return and changed something.
 */
export async function syncReturnPickupCarrier(client, providerShipmentId, jloStatus, rawStatus) {
  if (!providerShipmentId) return false;

  const { data: returnShipment, error } = await client
    .from('return_shipments')
    .select('id, return_request_id, status')
    .eq('provider', 'shipbubble')
    .eq('provider_shipment_id', String(providerShipmentId))
    .maybeSingle();
  if (error || !returnShipment) return false;

  const step = CARRIER_STATUS_TO_STEP[jloStatus];
  if (step) return applyStep(client, returnShipment, step, 'courier');

  if (CARRIER_EXCEPTIONS.has(jloStatus)) {
    await appendTimeline(client, returnShipment.return_request_id, {
      status: null,
      entry: {
        stage: 'courier_exception',
        label: `Courier update: ${rawStatus || jloStatus}. Needs staff attention`,
        actor: 'courier',
      },
    });
    return true;
  }
  return false;
}
