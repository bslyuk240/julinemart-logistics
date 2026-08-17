import { requireActiveRider, jsonResponse, headers } from './services/requireRider.js';
import { resolveSender } from './services/resolveSender.js';
import { refreshOverallOrderStatus } from './helpers/orderStatusHelper.js';
import {
  buildOrderDeepLink,
  extractCustomerIdFromOrder,
  extractOrderReference,
  sendPushToCustomer,
} from './services/pushNotifications.js';
import { syncShipmentBestEffort } from './services/shipmentSync.js';

// picked up -> en route (out_for_delivery) -> delivered. Matches the
// existing local-rider status set used by local-status.js — riders never
// see/enter in_transit, that's an inter-city Fez concept.
const NEXT_STATUS = {
  assigned: 'picked_up',
  picked_up: 'out_for_delivery',
  out_for_delivery: 'delivered',
};

const SUB_ORDER_SELECT = `
  id, main_order_id, tracking_number, status, courier_id, assigned_rider_id, metadata,
  allocated_shipping_fee, courier_charge, delivery_proof_url,
  picked_up_at, out_for_delivery_at, delivered_at,
  vendors ( store_name, address, city, state, phone, fez_collection_method,
    approved_vendor_locations ( fez_hub_name, fez_hub_address, courier_hubs ( name, address, city, state, phone ) ) ),
  hubs ( name, address, city, state, phone ),
  orders:main_order_id ( id, order_number, customer_name, customer_phone, customer_email,
    delivery_address, delivery_city, delivery_state, delivery_landmark, metadata )
`;

function isAccepted(metadata) {
  return Boolean(metadata && typeof metadata === 'object' && metadata.rider_accepted_at);
}

function summarize(subOrder) {
  const pickup = resolveSender(subOrder);
  const order = subOrder.orders || {};
  const fee = Number(subOrder.allocated_shipping_fee ?? subOrder.courier_charge ?? 0) || 0;
  return {
    id: subOrder.id,
    tracking_number: subOrder.tracking_number,
    status: subOrder.status,
    accepted: isAccepted(subOrder.metadata),
    fee,
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
    delivery_proof_url: subOrder.delivery_proof_url || null,
    picked_up_at: subOrder.picked_up_at,
    out_for_delivery_at: subOrder.out_for_delivery_at,
    delivered_at: subOrder.delivered_at,
  };
}

async function handleGet(rider, adminClient) {
  const { data: subOrders, error } = await adminClient
    .from('sub_orders')
    .select(SUB_ORDER_SELECT)
    .eq('assigned_rider_id', rider.id)
    .in('status', ['assigned', 'picked_up', 'out_for_delivery'])
    .order('created_at', { ascending: true });

  if (error) {
    console.error('rider-jobs GET error:', error);
    return jsonResponse(500, { success: false, error: 'Failed to load jobs' });
  }

  const pending = [];
  let active = null;
  for (const so of subOrders || []) {
    if (so.status === 'assigned' && !isAccepted(so.metadata)) {
      pending.push(summarize(so));
    } else {
      // First accepted-but-not-delivered job is "the" active job — a rider
      // works one delivery at a time in this build.
      if (!active) active = summarize(so);
    }
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const { data: deliveredToday } = await adminClient
    .from('sub_orders')
    .select('allocated_shipping_fee, courier_charge')
    .eq('assigned_rider_id', rider.id)
    .eq('status', 'delivered')
    .gte('delivered_at', todayStart.toISOString());

  const today = (deliveredToday || []).reduce(
    (acc, row) => {
      acc.count += 1;
      acc.earnings += Number(row.allocated_shipping_fee ?? row.courier_charge ?? 0) || 0;
      return acc;
    },
    { count: 0, earnings: 0 }
  );

  return jsonResponse(200, { success: true, data: { pending, active, today, online: Boolean(rider.is_online) } });
}

async function loadOwnedSubOrder(adminClient, riderId, subOrderId) {
  const { data: subOrder, error } = await adminClient
    .from('sub_orders')
    .select(SUB_ORDER_SELECT)
    .eq('id', subOrderId)
    .maybeSingle();

  if (error || !subOrder) return { errorResponse: jsonResponse(404, { success: false, error: 'Job not found' }) };
  if (subOrder.assigned_rider_id !== riderId) {
    return { errorResponse: jsonResponse(403, { success: false, error: 'not_your_job', message: 'This job is not assigned to you' }) };
  }
  return { subOrder };
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

async function handlePost(rider, adminClient, body) {
  const { sub_order_id, action } = body;
  if (!sub_order_id || !action) {
    return jsonResponse(400, { success: false, error: 'Missing required fields: sub_order_id, action' });
  }

  const owned = await loadOwnedSubOrder(adminClient, rider.id, sub_order_id);
  if (owned.errorResponse) return owned.errorResponse;
  const { subOrder } = owned;
  const existingMetadata = subOrder.metadata && typeof subOrder.metadata === 'object' && !Array.isArray(subOrder.metadata) ? subOrder.metadata : {};

  if (action === 'accept') {
    if (subOrder.status !== 'assigned' || isAccepted(subOrder.metadata)) {
      return jsonResponse(409, { success: false, error: 'Job is not awaiting acceptance' });
    }
    const acceptedMetadata = { ...existingMetadata, rider_accepted_at: new Date().toISOString() };
    const { error } = await adminClient
      .from('sub_orders')
      .update({ metadata: acceptedMetadata })
      .eq('id', sub_order_id);
    if (error) return jsonResponse(500, { success: false, error: error.message });

    await syncShipmentBestEffort(
      adminClient,
      { subOrderId: sub_order_id, fields: { metadata: acceptedMetadata } },
      'rider-jobs accept'
    );

    await adminClient.from('tracking_events').insert({
      sub_order_id,
      status: subOrder.status,
      description: `${rider.full_name} accepted the delivery`,
      actor_type: 'rider',
      source: 'rider_app',
    });

    return jsonResponse(200, { success: true, data: { accepted: true } });
  }

  if (action === 'decline') {
    if (isAccepted(subOrder.metadata)) {
      return jsonResponse(409, { success: false, error: 'Cannot decline a job you already accepted' });
    }
    const declineLog = Array.isArray(existingMetadata.declined_by) ? existingMetadata.declined_by : [];
    const declinedMetadata = { ...existingMetadata, declined_by: [...declineLog, { rider_id: rider.id, at: new Date().toISOString() }] };
    const { error } = await adminClient
      .from('sub_orders')
      .update({ assigned_rider_id: null, metadata: declinedMetadata })
      .eq('id', sub_order_id);
    if (error) return jsonResponse(500, { success: false, error: error.message });

    await syncShipmentBestEffort(
      adminClient,
      { subOrderId: sub_order_id, fields: { assigned_rider_id: null, metadata: declinedMetadata } },
      'rider-jobs decline'
    );

    await adminClient.from('tracking_events').insert({
      sub_order_id,
      status: subOrder.status,
      description: `${rider.full_name} declined the delivery`,
      actor_type: 'rider',
      source: 'rider_app',
    });

    return jsonResponse(200, { success: true, data: { declined: true } });
  }

  if (action === 'advance') {
    if (!isAccepted(subOrder.metadata)) {
      return jsonResponse(409, { success: false, error: 'Accept the job before updating its status' });
    }
    const targetStatus = NEXT_STATUS[subOrder.status];
    if (!targetStatus || body.target_status !== targetStatus) {
      return jsonResponse(400, { success: false, error: `Next status must be "${targetStatus || 'none'}"` });
    }
    if (targetStatus === 'delivered' && !body.delivery_proof_url) {
      return jsonResponse(400, { success: false, error: 'A delivery photo is required to confirm delivery' });
    }

    const timestampColumn = { picked_up: 'picked_up_at', out_for_delivery: 'out_for_delivery_at', delivered: 'delivered_at' }[targetStatus];
    const update = { status: targetStatus, [timestampColumn]: new Date().toISOString() };
    if (targetStatus === 'delivered' && body.delivery_proof_url) update.delivery_proof_url = body.delivery_proof_url;

    const { error } = await adminClient.from('sub_orders').update(update).eq('id', sub_order_id);
    if (error) return jsonResponse(500, { success: false, error: error.message });

    await syncShipmentBestEffort(
      adminClient,
      { subOrderId: sub_order_id, fields: { status: targetStatus, [timestampColumn]: update[timestampColumn], ...(update.delivery_proof_url ? { delivery_proof_url: update.delivery_proof_url } : {}) } },
      'rider-jobs advance'
    );

    const description = {
      picked_up: `${rider.full_name} picked up the package`,
      out_for_delivery: `${rider.full_name} is on the way`,
      delivered: `${rider.full_name} confirmed delivery`,
    }[targetStatus];

    await adminClient.from('tracking_events').insert({
      sub_order_id,
      status: targetStatus,
      description,
      actor_type: 'rider',
      source: 'rider_app',
    });

    if (subOrder.main_order_id) {
      try {
        await refreshOverallOrderStatus(adminClient, subOrder.main_order_id);
      } catch (refreshErr) {
        console.error('rider-jobs refreshOverallOrderStatus failed:', refreshErr);
      }
    }

    await notifyCustomer(subOrder, targetStatus);

    return jsonResponse(200, { success: true, data: { status: targetStatus } });
  }

  return jsonResponse(400, { success: false, error: `Unknown action: ${action}` });
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

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
