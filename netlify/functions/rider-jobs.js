import { requireActiveRider, jsonResponse, headers } from './services/requireRider.js';
import { checkRateLimit } from './services/rate-limit.js';
import { resolveSender } from './services/resolveSender.js';
import { refreshOverallOrderStatus } from './helpers/orderStatusHelper.js';
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

const SUB_ORDER_DETAIL_SELECT = `
  id, main_order_id, allocated_shipping_fee, courier_charge,
  vendors ( store_name, address, city, state, phone, fez_collection_method,
    approved_vendor_locations ( fez_hub_name, fez_hub_address, courier_hubs ( name, address, city, state, phone ) ) ),
  hubs ( name, address, city, state, phone ),
  orders:main_order_id ( id, order_number, customer_name, customer_phone, customer_email,
    delivery_address, delivery_city, delivery_state, delivery_landmark, metadata )
`;

function isAccepted(metadata) {
  return Boolean(metadata && typeof metadata === 'object' && metadata.rider_accepted_at);
}

async function fetchSourceDetails(adminClient, shipmentRows) {
  const subOrderIds = shipmentRows.filter((s) => s.source_type === 'sub_order').map((s) => s.sub_order_id);
  const manualIds = shipmentRows.filter((s) => s.source_type === 'manual_shipment').map((s) => s.manual_shipment_id);

  const [subOrdersRes, manualRes] = await Promise.all([
    subOrderIds.length
      ? adminClient.from('sub_orders').select(SUB_ORDER_DETAIL_SELECT).in('id', subOrderIds)
      : Promise.resolve({ data: [] }),
    manualIds.length
      ? adminClient.from('manual_shipments').select('id, sender, recipient, item_description').in('id', manualIds)
      : Promise.resolve({ data: [] }),
  ]);

  return {
    subOrderMap: new Map((subOrdersRes.data || []).map((r) => [r.id, r])),
    manualMap: new Map((manualRes.data || []).map((r) => [r.id, r])),
  };
}

function summarizeShipment(s, subOrderMap, manualMap) {
  const base = {
    id: s.id,
    tracking_number: s.tracking_number,
    status: s.status,
    accepted: isAccepted(s.metadata),
    delivery_proof_url: s.delivery_proof_url || null,
    assigned_at: s.created_at,
    picked_up_at: s.picked_up_at,
    out_for_delivery_at: s.out_for_delivery_at,
    delivered_at: s.delivered_at,
  };

  if (s.source_type === 'sub_order') {
    const subOrder = subOrderMap.get(s.sub_order_id);
    if (!subOrder) return null;
    const pickup = resolveSender(subOrder);
    const order = subOrder.orders || {};
    return {
      ...base,
      // rider_payout is the commission-adjusted amount, frozen at
      // assign/broadcast time — this is what the rider actually earns, not
      // the customer's full shipping fee. Falls back to the old full-fee
      // read only for shipments assigned before rider_payout existed.
      fee: s.rider_payout ?? (Number(subOrder.allocated_shipping_fee ?? subOrder.courier_charge ?? 0) || 0),
      order_number: order.order_number || null,
      pickup: { name: pickup.name, address: pickup.address, city: pickup.city, state: pickup.state, phone: pickup.phone },
      dropoff: {
        customer_name: order.customer_name || null,
        customer_phone: order.customer_phone || null,
        address: order.delivery_address || null,
        city: order.delivery_city || null,
        state: order.delivery_state || null,
        landmark: order.delivery_landmark || null,
      },
    };
  }

  // manual_shipment — rider_payout is only populated for shipments assigned
  // after that field existed; older ones still show 0 (same as before).
  // sender/recipient are already {name, address, city, state, phone}
  // shaped, matching the sub_order pickup/dropoff shape.
  const manual = manualMap.get(s.manual_shipment_id);
  if (!manual) return null;
  const sender = manual.sender || {};
  const recipient = manual.recipient || {};
  return {
    ...base,
    fee: s.rider_payout ?? 0,
    order_number: null,
    pickup: { name: sender.name || null, address: sender.address || null, city: sender.city || null, state: sender.state || null, phone: sender.phone || null },
    dropoff: {
      customer_name: recipient.name || null,
      customer_phone: recipient.phone || null,
      address: recipient.address || null,
      city: recipient.city || null,
      state: recipient.state || null,
      landmark: null,
    },
  };
}

const SHIPMENT_LIST_SELECT =
  'id, source_type, sub_order_id, manual_shipment_id, status, tracking_number, metadata, delivery_proof_url, picked_up_at, out_for_delivery_at, delivered_at, created_at, rider_payout';

async function handleGet(rider, adminClient) {
  const riderArea = rider.approved_vendor_locations || null;

  const [{ data: shipmentRows, error }, availableResult] = await Promise.all([
    adminClient
      .from('shipments')
      .select(SHIPMENT_LIST_SELECT)
      .eq('assigned_rider_id', rider.id)
      .in('status', ['assigned', 'picked_up', 'out_for_delivery'])
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
    return { errorResponse: jsonResponse(403, { success: false, error: 'not_your_job', message: 'This job is not assigned to you' }) };
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

  const { data: shipment, error } = await adminClient
    .from('shipments')
    .select('id, source_type, sub_order_id, manual_shipment_id, status, assigned_rider_id, broadcast_city, broadcast_state')
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
      ...(isSubOrder ? { rider_name: rider.full_name, rider_phone: rider.phone } : {}),
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
          error: "That code doesn't match this delivery — scan the label on this specific package.",
        });
      }
    }

    const timestampColumn = { picked_up: 'picked_up_at', out_for_delivery: 'out_for_delivery_at', delivered: 'delivered_at' }[targetStatus];
    const update = { status: targetStatus, [timestampColumn]: new Date().toISOString() };
    if (targetStatus === 'delivered' && body.delivery_proof_url) update.delivery_proof_url = body.delivery_proof_url;

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
