/**
 * Keeps a return in step with its local-rider pickup.
 *
 * The rider moves a manual shipment: picked up from the customer, then
 * dropped at the hub (at_hub). Those are the same milestones the return
 * shows the customer and staff: in transit, then delivered to hub. Called from
 * rider-jobs after it advances a manual shipment. Best-effort: a failure here
 * must never undo or block the rider's own status change.
 */
const STEP_TO_RETURN_STATUS = {
  picked_up: { status: 'in_transit', label: 'Picked up from customer', stage: 'pickup_collected' },
  at_hub: { status: 'delivered_to_hub', label: 'Delivered to hub', stage: 'delivered_to_hub' },
};

export async function syncReturnPickupProgress(client, manualShipmentId, riderStatus) {
  const step = STEP_TO_RETURN_STATUS[riderStatus];
  if (!step || !manualShipmentId) return false;

  const { data: returnShipment, error } = await client
    .from('return_shipments')
    .select('id, return_request_id, status')
    .eq('manual_shipment_id', manualShipmentId)
    .maybeSingle();
  // No row (or the migration isn't applied): this manual shipment isn't a
  // return pickup, which is the normal case. Nothing to do.
  if (error || !returnShipment) return false;
  if (returnShipment.status === step.status) return false;

  await client.from('return_shipments').update({ status: step.status }).eq('id', returnShipment.id);

  if (returnShipment.return_request_id) {
    const { data: request } = await client
      .from('return_requests')
      .select('id, status, resolution_timeline')
      .eq('id', returnShipment.return_request_id)
      .maybeSingle();
    if (request) {
      const timeline = Array.isArray(request.resolution_timeline) ? [...request.resolution_timeline] : [];
      timeline.push({ at: new Date().toISOString(), stage: step.stage, label: step.label, actor: 'rider' });
      await client
        .from('return_requests')
        .update({ status: step.status, resolution_timeline: timeline })
        .eq('id', request.id);
    }
  }
  return true;
}
