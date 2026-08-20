import { requireActiveRider, jsonResponse, headers } from './services/requireRider.js';
import { checkRateLimit } from './services/rate-limit.js';
import { refreshOverallOrderStatus } from './helpers/orderStatusHelper.js';
import { isAccepted, SHIPMENT_LIST_SELECT, fetchSourceDetails, summarizeShipment, podLevelForValue } from './services/shipmentSummary.js';
import { ensureTrackingAndWaybill } from './services/trackingNumbers.js';
import {
  buildOrderDeepLink,
  extractCustomerIdFromOrder,
  extractOrderReference,
  sendPushToCustomer,
} from './services/pushNotifications.js';
import { syncShipmentBestEffort } from './services/shipmentSync.js';
import { normalizeScanCode } from './services/scanLookup.js';
import { notifyRider, notifyRiderArea, notifyDispatch } from './services/riderRealtime.js';

// picked up -> en route (out_for_delivery) -> delivered. Matches the
// existing local-rider status set used by local-status.js — riders never
// see/enter in_transit, that's an inter-city Fez concept.
const NEXT_STATUS = {
  assigned: 'picked_up',
  picked_up: 'out_for_delivery',
  out_for_delivery: 'delivered',
};

// Shared between report_problem (log only, no status change) and
// fail_delivery (ends the delivery attempt) — same incident taxonomy, just
// two different actions a rider can take on it.
const INCIDENT_REASONS = [
  'vendor_not_ready',
  'vendor_closed',
  'package_unavailable',
  'wrong_address',
  'customer_unreachable',
  'customer_refused',
  'package_damaged',
  'vehicle_breakdown',
  'safety_issue',
  'other',
];

const INCIDENT_REASON_LABEL = {
  vendor_not_ready: 'Vendor not ready',
  vendor_closed: 'Vendor closed',
  package_unavailable: 'Package unavailable',
  wrong_address: 'Wrong address',
  customer_unreachable: 'Customer unreachable',
  customer_refused: 'Customer refused delivery',
  package_damaged: 'Package damaged',
  vehicle_breakdown: 'Vehicle breakdown',
  safety_issue: 'Safety issue',
  other: 'Other',
};

// A rider is only "busy" (blocks accept/claim, counts as their one active
// job on Home/ActiveDelivery) for statuses that still need their action.
// 'failed' is deliberately excluded — the rider has nothing to do until
// staff reviews it and either requires a return or resolves it another
// way (see admin-delivery-problems.js's require_return action).
const RIDER_OWNED_STATUSES = ['assigned', 'picked_up', 'out_for_delivery', 'return_required', 'returning'];

// A rider works one delivery at a time in this build (see handleGet's
// "active" selection below) — broadcasts and direct assignments still reach
// a busy rider, so they can see and queue up what's next, but committing to
// a second job before finishing the first would leave it with nowhere to go
// in the UI, since only one job is ever tracked as "active". Gates accept
// and claim (see handlePost/handleClaim) — not assignment/broadcast itself.
async function hasActiveJob(adminClient, riderId) {
  const { data } = await adminClient
    .from('shipments')
    .select('status, metadata')
    .eq('assigned_rider_id', riderId)
    .in('status', RIDER_OWNED_STATUSES);
  return (data || []).some((s) => s.status !== 'assigned' || isAccepted(s.metadata));
}

// shipments carries the shared dispatch fields (status, tracking, courier,
// rider, timestamps) for both sub_orders and manual_shipments — see
// shipmentSync.js. This file reads shipments as the list of "what's
// assigned to me" and fans out to whichever source table each row came
// from for its business-specific details (pickup/dropoff, order number).
// The write side still targets the source table directly (sub_orders or
// manual_shipments) and mirrors into shipments — every OTHER consumer
// (Orders.tsx, emails, waybill generation, refreshOverallOrderStatus)
// still reads sub_orders/manual_shipments directly and hasn't migrated,
// so those columns must stay correct too.

async function handleGet(rider, adminClient) {
  const riderArea = rider.approved_vendor_locations || null;

  const [{ data: shipmentRows, error }, availableResult] = await Promise.all([
    adminClient
      .from('shipments')
      .select(SHIPMENT_LIST_SELECT)
      .eq('assigned_rider_id', rider.id)
      .in('status', RIDER_OWNED_STATUSES)
      .order('created_at', { ascending: true }),
    rider.is_online && riderArea?.city && riderArea?.state
      ? adminClient
          .from('shipments')
          .select(SHIPMENT_LIST_SELECT)
          .eq('status', 'broadcasting')
          .is('assigned_rider_id', null)
          .ilike('broadcast_city', riderArea.city)
          .ilike('broadcast_state', riderArea.state)
          .order('created_at', { ascending: true })
      : Promise.resolve({ data: [] }),
  ]);

  if (error) {
    console.error('rider-jobs GET error:', error);
    return jsonResponse(500, { success: false, error: 'Failed to load jobs' });
  }

  const declinedByRider = (metadata) =>
    Array.isArray(metadata?.declined_by) && metadata.declined_by.some((d) => d.rider_id === rider.id);
  const availableRows = (availableResult.data || []).filter((s) => !declinedByRider(s.metadata));

  const { subOrderMap, manualMap } = await fetchSourceDetails(adminClient, [...(shipmentRows || []), ...availableRows]);

  const pending = [];
  let active = null;
  for (const s of shipmentRows || []) {
    const summary = summarizeShipment(s, subOrderMap, manualMap);
    if (!summary) continue; // defensive: source row deleted out from under a shipment
    if (s.status === 'assigned' && !isAccepted(s.metadata)) {
      pending.push(summary);
    } else if (!active) {
      // First accepted-but-not-delivered job is "the" active job — a rider
      // works one delivery at a time in this build.
      active = summary;
    }
  }

  const available = availableRows
    .map((s) => summarizeShipment(s, subOrderMap, manualMap))
    .filter(Boolean);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const { data: deliveredToday } = await adminClient
    .from('shipments')
    .select('source_type, sub_order_id, rider_payout')
    .eq('assigned_rider_id', rider.id)
    .eq('status', 'delivered')
    .gte('delivered_at', todayStart.toISOString());

  // rider_payout covers anything assigned after that field existed.
  // Fall back to the old full-fee read, sub-order-only, for older
  // deliveries still sitting with rider_payout null.
  const legacySubOrderIds = (deliveredToday || [])
    .filter((r) => r.source_type === 'sub_order' && r.rider_payout == null)
    .map((r) => r.sub_order_id);
  let feeBySubOrderId = new Map();
  if (legacySubOrderIds.length) {
    const { data: feeRows } = await adminClient
      .from('sub_orders')
      .select('id, allocated_shipping_fee, courier_charge')
      .in('id', legacySubOrderIds);
    feeBySubOrderId = new Map((feeRows || []).map((r) => [r.id, Number(r.allocated_shipping_fee ?? r.courier_charge ?? 0) || 0]));
  }

  const today = (deliveredToday || []).reduce(
    (acc, row) => {
      acc.count += 1;
      acc.earnings += row.rider_payout ?? feeBySubOrderId.get(row.sub_order_id) ?? 0;
      return acc;
    },
    { count: 0, earnings: 0 }
  );

  return jsonResponse(200, {
    success: true,
    data: {
      pending,
      active,
      available,
      today,
      online: Boolean(rider.is_online),
      rider_name: rider.full_name,
      rider_area: riderArea ? { city: riderArea.city, state: riderArea.state } : null,
    },
  });
}

async function loadOwnedShipment(adminClient, riderId, shipmentId) {
  const { data: shipment, error } = await adminClient
    .from('shipments')
    .select('id, source_type, sub_order_id, manual_shipment_id, assigned_rider_id, status, metadata, tracking_number, waybill_number')
    .eq('id', shipmentId)
    .maybeSingle();

  if (error || !shipment) return { errorResponse: jsonResponse(404, { success: false, error: 'Job not found' }) };
  if (shipment.assigned_rider_id !== riderId) {
    return { errorResponse: jsonResponse(403, { success: false, error: 'not_your_job', message: "This shipment isn't assigned to you." }) };
  }
  return { shipment };
}

async function notifyCustomer(subOrder, status) {
  const order = subOrder.orders;
  if (!order) return;

  const customerId = extractCustomerIdFromOrder(order);
  const orderRef = extractOrderReference(order) || subOrder.main_order_id;
  const deepLink = buildOrderDeepLink(orderRef);
  const pushMeta = { status, orderReference: String(orderRef), ...(deepLink ? { targetPath: deepLink } : {}) };

  const copy = {
    picked_up: { title: 'Order picked up', message: `Your order ${orderRef} has been picked up by our rider.` },
    out_for_delivery: { title: 'Order out for delivery', message: `Your order ${orderRef} is on the way.` },
    delivered: { title: 'Order delivered', message: `Your order ${orderRef} has been delivered.` },
  }[status];
  if (!copy) return;

  const pushResult = await sendPushToCustomer(customerId, { ...copy, type: 'order_update', data: pushMeta });
  if (!pushResult.success && !pushResult.skipped) {
    console.warn('rider-jobs push failed:', pushResult);
  }
}

async function handleClaim(rider, adminClient, shipmentId) {
  if (!rider.is_online) {
    return jsonResponse(403, { success: false, error: 'go_online_required', message: 'Go online to claim deliveries' });
  }
  if (await hasActiveJob(adminClient, rider.id)) {
    return jsonResponse(409, { success: false, error: 'active_job_exists', message: 'Finish your current delivery before accepting another.' });
  }

  const { data: shipment, error } = await adminClient
    .from('shipments')
    .select('id, source_type, sub_order_id, manual_shipment_id, status, assigned_rider_id, broadcast_city, broadcast_state, tracking_number, waybill_number')
    .eq('id', shipmentId)
    .maybeSingle();

  if (error || !shipment) return jsonResponse(404, { success: false, error: 'Job not found' });
  if (shipment.status !== 'broadcasting' || shipment.assigned_rider_id) {
    return jsonResponse(409, { success: false, error: 'already_claimed', message: 'This job is no longer available' });
  }

  const riderArea = rider.approved_vendor_locations;
  const sameCity = riderArea?.city && shipment.broadcast_city && riderArea.city.toLowerCase() === shipment.broadcast_city.toLowerCase();
  const sameState = riderArea?.state && shipment.broadcast_state && riderArea.state.toLowerCase() === shipment.broadcast_state.toLowerCase();
  if (!sameCity || !sameState) {
    return jsonResponse(403, { success: false, error: 'out_of_area', message: "This job isn't in your service area" });
  }

  const isSubOrder = shipment.source_type === 'sub_order';
  const sourceTable = isSubOrder ? 'sub_orders' : 'manual_shipments';
  const sourceId = isSubOrder ? shipment.sub_order_id : shipment.manual_shipment_id;
  const riderVehicle = rider.vehicle_type ? `${rider.vehicle_type}${rider.vehicle_plate ? ` · ${rider.vehicle_plate}` : ''}` : null;

  // Broadcast+claim was the one dispatch path that never generated a
  // tracking/waybill number — only direct-assign did (assign-rider.js /
  // manual-shipment-assign-rider.js). A claimed manual_shipment could end
  // up with neither ever set, i.e. nothing for the rider to scan.
  const { trackingNumber, waybillNumber } = await ensureTrackingAndWaybill(adminClient, {
    trackingNumber: shipment.tracking_number,
    waybillNumber: shipment.waybill_number,
  });

  // Conditional update is the claim race's referee: only the request that
  // still finds status='broadcasting' with no rider yet wins the row.
  // Whoever loses gets zero rows back, not an error — that's how they know
  // someone else got there first.
  const { data: claimedRow, error: claimError } = await adminClient
    .from(sourceTable)
    .update({
      assigned_rider_id: rider.id,
      status: 'assigned',
      delivery_person_name: rider.full_name,
      delivery_person_phone: rider.phone,
      delivery_person_vehicle: riderVehicle,
      tracking_number: trackingNumber,
      ...(waybillNumber ? { waybill_number: waybillNumber } : {}),
      ...(isSubOrder ? { rider_name: rider.full_name, rider_phone: rider.phone } : {}),
      // Fez-specific leftovers from a prior dispatch attempt, if any — see
      // assign-rider.js for why these must be cleared on assignment to a
      // local rider (stale courier_tracking_url makes the customer tracking
      // page's "Track on courier site" button point at Fez).
      courier_tracking_url: null,
      courier_waybill: null,
      courier_shipment_id: null,
    })
    .eq('id', sourceId)
    .eq('status', 'broadcasting')
    .is('assigned_rider_id', null)
    .select()
    .maybeSingle();

  if (claimError) return jsonResponse(500, { success: false, error: claimError.message });
  if (!claimedRow) return jsonResponse(409, { success: false, error: 'already_claimed', message: 'Another rider already grabbed this job' });

  const syncKey = isSubOrder ? 'subOrderId' : 'manualShipmentId';
  await syncShipmentBestEffort(
    adminClient,
    {
      [syncKey]: sourceId,
      fields: {
        assigned_rider_id: rider.id,
        status: 'assigned',
        delivery_person_name: rider.full_name,
        delivery_person_phone: rider.phone,
        delivery_person_vehicle: riderVehicle,
        tracking_number: trackingNumber,
        ...(waybillNumber ? { waybill_number: waybillNumber } : {}),
        courier_tracking_url: null,
        courier_waybill: null,
        courier_shipment_id: null,
      },
    },
    'rider-jobs claim'
  );

  await adminClient.from('tracking_events').insert({
    ...(isSubOrder ? { sub_order_id: sourceId } : { manual_shipment_id: sourceId }),
    shipment_id: shipmentId,
    status: 'assigned',
    description: `${rider.full_name} claimed the delivery`,
    actor_type: 'rider',
    source: 'rider_app',
  });

  await notifyRiderArea(shipment.broadcast_city, shipment.broadcast_state, 'job_removed', { shipment_id: shipmentId });
  await notifyDispatch(shipment.source_type, sourceId, 'updated', { status: 'assigned' });

  return jsonResponse(200, { success: true, data: { claimed: true } });
}

async function handlePost(rider, adminClient, body) {
  const { shipment_id, action } = body;
  if (!shipment_id || !action) {
    return jsonResponse(400, { success: false, error: 'Missing required fields: shipment_id, action' });
  }

  if (action === 'claim') {
    return handleClaim(rider, adminClient, shipment_id);
  }

  const owned = await loadOwnedShipment(adminClient, rider.id, shipment_id);
  if (owned.errorResponse) return owned.errorResponse;
  const { shipment } = owned;
  const isSubOrder = shipment.source_type === 'sub_order';
  const sourceTable = isSubOrder ? 'sub_orders' : 'manual_shipments';
  const sourceId = isSubOrder ? shipment.sub_order_id : shipment.manual_shipment_id;
  const syncKey = isSubOrder ? 'subOrderId' : 'manualShipmentId';
  const trackingEventSourceField = isSubOrder ? { sub_order_id: sourceId } : { manual_shipment_id: sourceId };
  const existingMetadata = shipment.metadata && typeof shipment.metadata === 'object' && !Array.isArray(shipment.metadata) ? shipment.metadata : {};

  if (action === 'accept') {
    if (shipment.status !== 'assigned' || isAccepted(shipment.metadata)) {
      return jsonResponse(409, { success: false, error: 'Job is not awaiting acceptance' });
    }
    if (await hasActiveJob(adminClient, rider.id)) {
      return jsonResponse(409, { success: false, error: 'active_job_exists', message: 'Finish your current delivery before accepting another.' });
    }
    const acceptedMetadata = { ...existingMetadata, rider_accepted_at: new Date().toISOString() };

    const { error } = await adminClient.from(sourceTable).update({ metadata: acceptedMetadata }).eq('id', sourceId);
    if (error) return jsonResponse(500, { success: false, error: error.message });

    await syncShipmentBestEffort(adminClient, { [syncKey]: sourceId, fields: { metadata: acceptedMetadata } }, 'rider-jobs accept');

    await adminClient.from('tracking_events').insert({
      ...trackingEventSourceField,
      shipment_id,
      status: shipment.status,
      description: `${rider.full_name} accepted the delivery`,
      actor_type: 'rider',
      source: 'rider_app',
    });

    await notifyDispatch(shipment.source_type, sourceId, 'updated', { status: shipment.status, accepted: true });

    return jsonResponse(200, { success: true, data: { accepted: true } });
  }

  if (action === 'decline') {
    if (isAccepted(shipment.metadata)) {
      return jsonResponse(409, { success: false, error: 'Cannot decline a job you already accepted' });
    }
    const declineLog = Array.isArray(existingMetadata.declined_by) ? existingMetadata.declined_by : [];
    const declinedMetadata = { ...existingMetadata, declined_by: [...declineLog, { rider_id: rider.id, at: new Date().toISOString() }] };

    const { error } = await adminClient.from(sourceTable).update({ assigned_rider_id: null, metadata: declinedMetadata }).eq('id', sourceId);
    if (error) return jsonResponse(500, { success: false, error: error.message });

    await syncShipmentBestEffort(adminClient, { [syncKey]: sourceId, fields: { assigned_rider_id: null, metadata: declinedMetadata } }, 'rider-jobs decline');

    await adminClient.from('tracking_events').insert({
      ...trackingEventSourceField,
      shipment_id,
      status: shipment.status,
      description: `${rider.full_name} declined the delivery`,
      actor_type: 'rider',
      source: 'rider_app',
    });

    await notifyDispatch(shipment.source_type, sourceId, 'updated', { status: shipment.status, declined: true });

    return jsonResponse(200, { success: true, data: { declined: true } });
  }

  // Logs a problem for staff visibility on this delivery — it does not
  // change shipment status or drive any workflow. Distinct incident types
  // that actually change what happens next (return required, reassign,
  // etc.) are a bigger, separate piece — see docs/rider-app-ux-rebuild.md.
  if (action === 'report_problem') {
    const { reason, note } = body;
    if (!INCIDENT_REASONS.includes(reason)) {
      return jsonResponse(400, { success: false, error: `reason must be one of: ${INCIDENT_REASONS.join(', ')}` });
    }

    await adminClient.from('tracking_events').insert({
      ...trackingEventSourceField,
      shipment_id,
      status: shipment.status,
      description: `${rider.full_name} reported a problem: ${INCIDENT_REASON_LABEL[reason]}${note ? ` — ${note}` : ''}`,
      actor_type: 'rider',
      source: 'rider_app',
      metadata: { type: 'problem_report', reason, note: note || null },
    });

    await notifyDispatch(shipment.source_type, sourceId, 'problem_reported', { status: shipment.status, reason });

    return jsonResponse(200, { success: true, data: { reported: true } });
  }

  // Ends a delivery attempt the rider can't complete — the shipment stays
  // assigned to them (they still physically hold the package) but drops off
  // the "mine" list (RIDER_OWNED_STATUSES excludes 'failed') until staff
  // reviews it via the Delivery Problems queue and either requires a return
  // (admin-delivery-problems.js's require_return, see below) or resolves it
  // another way. Reuses the exact incident taxonomy report_problem does, and
  // tags the tracking event the same way (metadata.type: 'problem_report')
  // so it surfaces in that same triage queue for free.
  if (action === 'fail_delivery') {
    if (!['picked_up', 'out_for_delivery'].includes(shipment.status)) {
      return jsonResponse(409, { success: false, error: 'Only a delivery you have already picked up can be marked failed' });
    }
    const { reason, note } = body;
    if (!INCIDENT_REASONS.includes(reason)) {
      return jsonResponse(400, { success: false, error: `reason must be one of: ${INCIDENT_REASONS.join(', ')}` });
    }

    // The reason/note live on the tracking_events row below (which is what
    // the Delivery Problems queue actually reads) — not worth also writing
    // them into metadata here, since shipmentSync.js's metadataForShipment()
    // only mirrors a fixed whitelist of keys into the unified shipments
    // table, and these two aren't on it.
    const update = { status: 'failed', failed_at: new Date().toISOString() };
    const sourceUpdate = isSubOrder ? update : { status: 'failed' };

    const { error } = await adminClient.from(sourceTable).update(sourceUpdate).eq('id', sourceId);
    if (error) return jsonResponse(500, { success: false, error: error.message });

    await syncShipmentBestEffort(adminClient, { [syncKey]: sourceId, fields: update }, 'rider-jobs fail_delivery');

    await adminClient.from('tracking_events').insert({
      ...trackingEventSourceField,
      shipment_id,
      status: 'failed',
      description: `${rider.full_name} could not complete the delivery: ${INCIDENT_REASON_LABEL[reason]}${note ? ` — ${note}` : ''}`,
      actor_type: 'rider',
      source: 'rider_app',
      metadata: { type: 'problem_report', reason, note: note || null },
    });

    await notifyDispatch(shipment.source_type, sourceId, 'updated', { status: 'failed', reason });

    return jsonResponse(200, { success: true, data: { status: 'failed' } });
  }

  // Staff decided (from the Delivery Problems queue) that this failed
  // delivery needs to come back — the rider taps through return_required ->
  // returning -> returned themselves, same self-confirm pattern as pickup.
  if (action === 'start_return') {
    if (shipment.status !== 'return_required') {
      return jsonResponse(409, { success: false, error: 'This delivery is not awaiting a return' });
    }
    const update = { status: 'returning' };
    const { error } = await adminClient.from(sourceTable).update(update).eq('id', sourceId);
    if (error) return jsonResponse(500, { success: false, error: error.message });

    await syncShipmentBestEffort(adminClient, { [syncKey]: sourceId, fields: update }, 'rider-jobs start_return');

    await adminClient.from('tracking_events').insert({
      ...trackingEventSourceField,
      shipment_id,
      status: 'returning',
      description: `${rider.full_name} started returning the package`,
      actor_type: 'rider',
      source: 'rider_app',
    });

    await notifyDispatch(shipment.source_type, sourceId, 'updated', { status: 'returning' });

    return jsonResponse(200, { success: true, data: { status: 'returning' } });
  }

  if (action === 'confirm_returned') {
    if (shipment.status !== 'returning') {
      return jsonResponse(409, { success: false, error: 'This delivery is not currently being returned' });
    }
    const update = { status: 'returned' };
    const { error } = await adminClient.from(sourceTable).update(update).eq('id', sourceId);
    if (error) return jsonResponse(500, { success: false, error: error.message });

    await syncShipmentBestEffort(adminClient, { [syncKey]: sourceId, fields: update }, 'rider-jobs confirm_returned');

    await adminClient.from('tracking_events').insert({
      ...trackingEventSourceField,
      shipment_id,
      status: 'returned',
      description: `${rider.full_name} confirmed the package was returned`,
      actor_type: 'rider',
      source: 'rider_app',
    });

    await notifyDispatch(shipment.source_type, sourceId, 'updated', { status: 'returned' });

    return jsonResponse(200, { success: true, data: { status: 'returned' } });
  }

  // Verifies a scanned code against this shipment WITHOUT changing anything
  // — the client shows the result (mockup screen 3: "Package verified" +
  // custody direction) and only calls `advance` once the rider taps
  // "Confirm Pickup". `advance` re-runs the same check server-side, so this
  // is a preview, not the authority — a client that skips straight to
  // `advance` still gets the same validation.
  if (action === 'verify_scan') {
    if (shipment.status !== 'assigned') {
      return jsonResponse(409, { success: false, error: 'already_collected', message: 'This package has already been collected.' });
    }
    if (!isAccepted(shipment.metadata)) {
      return jsonResponse(409, { success: false, error: 'not_accepted', message: 'Accept the job before scanning for pickup.' });
    }

    const scanned = normalizeScanCode(body.scanned_code);
    if (!scanned) {
      return jsonResponse(400, { success: false, error: 'empty_scan', message: 'Scan the label on this package to confirm pickup' });
    }
    const expected = [shipment.tracking_number, shipment.waybill_number].map((v) => normalizeScanCode(v)).filter(Boolean);
    if (!expected.some((code) => code.toUpperCase() === scanned.toUpperCase())) {
      return jsonResponse(400, { success: false, error: 'wrong_package', message: "This isn't your assigned shipment." });
    }

    const { subOrderMap, manualMap } = await fetchSourceDetails(adminClient, [shipment]);
    const summary = summarizeShipment(shipment, subOrderMap, manualMap);

    return jsonResponse(200, {
      success: true,
      data: {
        verified: true,
        tracking_number: shipment.tracking_number,
        rider_name: rider.full_name,
        from_custodian: 'Vendor',
        to_custodian: 'Rider',
        pickup_name: summary?.pickup?.name || null,
      },
    });
  }

  if (action === 'advance') {
    if (!isAccepted(shipment.metadata)) {
      return jsonResponse(409, { success: false, error: 'Accept the job before updating its status' });
    }
    const targetStatus = NEXT_STATUS[shipment.status];
    if (!targetStatus || body.target_status !== targetStatus) {
      return jsonResponse(400, { success: false, error: `Next status must be "${targetStatus || 'none'}"` });
    }
    if (targetStatus === 'delivered' && !body.delivery_proof_url) {
      return jsonResponse(400, { success: false, error: 'A delivery photo is required to confirm delivery' });
    }
    // High-value orders also require a customer signature — see
    // shipmentSummary.js's podLevelForValue. Checked server-side (not just
    // trusted from the client) against the same source-table value column
    // the rider-facing summary computes pod_level from.
    if (targetStatus === 'delivered' && !body.signature_url) {
      const valueColumn = isSubOrder ? 'subtotal' : 'item_value';
      const { data: valueRow } = await adminClient.from(sourceTable).select(valueColumn).eq('id', sourceId).maybeSingle();
      if (podLevelForValue(valueRow?.[valueColumn]) === 'verified') {
        return jsonResponse(400, {
          success: false,
          error: 'signature_required',
          message: 'A customer signature is required to confirm delivery for this order',
        });
      }
    }

    // Pickup requires scanning the package's own printed label — a chain-
    // of-custody check that the rider actually has the right package in
    // hand, not just a status tap. Every dispatched package gets a label
    // (see generate-label.js), so this can be a hard gate rather than a
    // best-effort nudge.
    if (targetStatus === 'picked_up') {
      const scanned = normalizeScanCode(body.scanned_code);
      if (!scanned) {
        return jsonResponse(400, { success: false, error: 'Scan the label on this package to confirm pickup' });
      }
      const expected = [shipment.tracking_number, shipment.waybill_number]
        .map((v) => normalizeScanCode(v))
        .filter(Boolean);
      if (!expected.some((code) => code.toUpperCase() === scanned.toUpperCase())) {
        return jsonResponse(400, {
          success: false,
          error: "This isn't your assigned shipment.",
        });
      }
    }

    const timestampColumn = { picked_up: 'picked_up_at', out_for_delivery: 'out_for_delivery_at', delivered: 'delivered_at' }[targetStatus];
    const update = { status: targetStatus, [timestampColumn]: new Date().toISOString() };
    if (targetStatus === 'delivered' && body.delivery_proof_url) update.delivery_proof_url = body.delivery_proof_url;
    if (targetStatus === 'delivered' && body.signature_url) update.signature_url = body.signature_url;

    // manual_shipments has no picked_up_at/out_for_delivery_at/delivered_at/
    // delivery_proof_url columns — those timestamps live only on the unified
    // shipments table for that source type, so limit the source-table write
    // to columns that actually exist there.
    const sourceUpdate = isSubOrder ? update : { status: targetStatus };

    const { error } = await adminClient.from(sourceTable).update(sourceUpdate).eq('id', sourceId);
    if (error) return jsonResponse(500, { success: false, error: error.message });

    await syncShipmentBestEffort(adminClient, { [syncKey]: sourceId, fields: update }, 'rider-jobs advance');

    const description = {
      picked_up: `${rider.full_name} picked up the package`,
      out_for_delivery: `${rider.full_name} is on the way`,
      delivered: `${rider.full_name} confirmed delivery`,
    }[targetStatus];

    await adminClient.from('tracking_events').insert({
      ...trackingEventSourceField,
      shipment_id,
      status: targetStatus,
      description,
      actor_type: 'rider',
      source: 'rider_app',
    });

    // Order-linked side effects (overall status recompute, customer push)
    // only apply to marketplace orders — manual shipments have no
    // customer account or main_order_id to notify.
    if (isSubOrder) {
      const { data: subOrderForNotify } = await adminClient
        .from('sub_orders')
        .select('main_order_id, orders:main_order_id ( id, order_number, customer_name, customer_phone, customer_email, delivery_city, delivery_state )')
        .eq('id', sourceId)
        .maybeSingle();

      if (subOrderForNotify?.main_order_id) {
        try {
          await refreshOverallOrderStatus(adminClient, subOrderForNotify.main_order_id);
        } catch (refreshErr) {
          console.error('rider-jobs refreshOverallOrderStatus failed:', refreshErr);
        }
        await notifyCustomer(subOrderForNotify, targetStatus);
      }
    }

    await notifyDispatch(shipment.source_type, sourceId, 'updated', { status: targetStatus });

    return jsonResponse(200, { success: true, data: { status: targetStatus } });
  }

  return jsonResponse(400, { success: false, error: `Unknown action: ${action}` });
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  // Home.tsx polls GET every 45s (~1.3/min); POST actions are user-driven taps.
  const { limited, response } = await checkRateLimit(event, {
    name: 'rider-jobs',
    max: 20,
    window: '1 m',
    retryAfterSeconds: 60,
  });
  if (limited) return response;

  const session = await requireActiveRider(event);
  if (session.errorResponse) return session.errorResponse;
  const { rider, adminClient } = session;

  if (event.httpMethod === 'GET') return handleGet(rider, adminClient);

  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return jsonResponse(400, { success: false, error: 'Invalid JSON' }); }
    return handlePost(rider, adminClient, body);
  }

  return jsonResponse(405, { success: false, error: 'Method not allowed' });
}
