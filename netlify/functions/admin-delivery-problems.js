/**
 * Admin triage queue for rider-reported delivery problems.
 *
 * Riders report problems from the Active Delivery screen (rider-jobs.js's
 * report_problem action) — that just logs a tracking_events row tagged
 * metadata.type = 'problem_report', it doesn't change shipment status or
 * drive any workflow. This endpoint is the read side: list those rows with
 * enough shipment/order/rider context for staff to triage without opening
 * each order individually.
 *
 * GET /api/admin-delivery-problems?reason=&include_closed=true|false
 *   include_closed defaults to false — hides reports on shipments that
 *   don't need staff action anymore: delivered, or already past the point
 *   where staff acted on a 'failed' one (return_required/returning/returned).
 *   'failed' itself stays open — it's the one status that DOES need a staff
 *   call (see the require_return action below).
 *
 * POST /api/admin-delivery-problems  { action: 'require_return', shipment_id }
 *   Moves a 'failed' shipment to 'return_required' — see handleRequireReturn.
 */
import { requireAdmin, jsonResponse, headers } from './services/global-sourcing-utils.js';
import { syncShipmentBestEffort } from './services/shipmentSync.js';
import { notifyRider } from './services/riderRealtime.js';
import { sendRiderPush } from './services/riderNotifications.js';
import { sendPushToCustomer, extractCustomerIdFromOrder, extractOrderReference, buildOrderDeepLink } from './services/pushNotifications.js';
import { sendLocalDeliveryStatusEmail } from '../../shared/riderAssignedEmail.js';
import { recordStaffAudit } from './services/auditLog.js';
import { sendWebhookEvent } from './services/webhookDelivery.js';
import { cancelGiftOrderByStaff, GiftCancelError } from './services/gift-cancel.js';
import {
  GIFT_MAX_CUSTOMER_FAULT_ATTEMPTS,
  countFailedAttempts,
  isGiftFulfilmentSubOrder,
  refundIsDue,
} from './services/gift-delivery-attempts.js';

// 'failed' stays open (needs a staff call); once staff acts (return_required)
// it's the rider's turn next, so it drops off this queue same as delivered.
const CLOSED_STATUSES = new Set(['delivered', 'return_required', 'returning', 'returned']);

// A failed delivery (rider-jobs.js's fail_delivery) needs a staff call on
// what happens next — this is the one option built so far: send it back the
// way it came. The rider who still physically holds the package works
// through return_required -> returning -> returned themselves (rider-jobs.js).
async function handleRequireReturn(event) {
  const auth = await requireAdmin(event, ['admin', 'manager', 'agent']);
  if (auth.errorResponse) return auth.errorResponse;
  const { adminClient } = auth;

  const { shipment_id } = JSON.parse(event.body || '{}');
  if (!shipment_id) return jsonResponse(400, { success: false, error: 'shipment_id is required' });

  const { data: shipment, error: loadError } = await adminClient
    .from('shipments')
    .select('id, source_type, sub_order_id, manual_shipment_id, status, assigned_rider_id, tracking_number, riders ( full_name, phone )')
    .eq('id', shipment_id)
    .maybeSingle();
  if (loadError || !shipment) return jsonResponse(404, { success: false, error: 'Shipment not found' });
  if (shipment.status !== 'failed') {
    return jsonResponse(409, { success: false, error: 'Only a failed delivery can be sent back for return' });
  }

  const isSubOrder = shipment.source_type === 'sub_order';
  const sourceTable = isSubOrder ? 'sub_orders' : 'manual_shipments';
  const sourceId = isSubOrder ? shipment.sub_order_id : shipment.manual_shipment_id;
  const syncKey = isSubOrder ? 'subOrderId' : 'manualShipmentId';

  const update = { status: 'return_required' };
  const { error } = await adminClient.from(sourceTable).update(update).eq('id', sourceId);
  if (error) return jsonResponse(500, { success: false, error: error.message });

  await syncShipmentBestEffort(adminClient, { [syncKey]: sourceId, fields: update }, 'admin-delivery-problems require_return');

  await adminClient.from('tracking_events').insert({
    ...(isSubOrder ? { sub_order_id: sourceId } : { manual_shipment_id: sourceId }),
    shipment_id,
    status: 'return_required',
    description: 'Staff requested this package be returned',
    actor_type: 'user',
    source: 'admin',
  });

  if (shipment.assigned_rider_id) {
    await notifyRider(shipment.assigned_rider_id, 'return_required', { shipment_id });
    const pushResult = await sendRiderPush(adminClient, shipment.assigned_rider_id, {
      title: 'Return required',
      message: 'A package needs to go back — open the app for details.',
      type: 'rider_return_required',
      data: { shipment_id, targetPath: '/' },
    });
    if (!pushResult.success && !pushResult.skipped) {
      console.warn('require_return push failed:', pushResult);
    }
  }

  // Customer-facing side of the same event — sub_orders only, since a
  // manual_shipment has no linked marketplace order/customer account.
  if (isSubOrder) {
    const { data: subOrderForNotify } = await adminClient
      .from('sub_orders')
      .select('main_order_id, orders:main_order_id ( id, order_number, customer_name, customer_phone, customer_email, delivery_city, delivery_state )')
      .eq('id', sourceId)
      .maybeSingle();
    const order = subOrderForNotify?.orders;
    if (order) {
      const customerId = extractCustomerIdFromOrder(order);
      const orderRef = extractOrderReference(order) || subOrderForNotify.main_order_id;
      const deepLink = buildOrderDeepLink(orderRef);
      const pushResult = await sendPushToCustomer(customerId, {
        title: 'Package being returned',
        message: `Order ${orderRef} could not be delivered and is being sent back to us.`,
        type: 'order_update',
        data: { status: 'return_required', orderReference: String(orderRef), ...(deepLink ? { targetPath: deepLink } : {}) },
      });
      if (!pushResult.success && !pushResult.skipped) {
        console.warn('require_return customer push failed:', pushResult);
      }
      try {
        await sendLocalDeliveryStatusEmail(adminClient, {
          phase: 'return_required',
          orderId: order.id,
          orderNumber: order.order_number ?? orderRef,
          customer_name: order.customer_name,
          customer_email: order.customer_email,
          tracking_number: shipment.tracking_number || '',
          rider_name: shipment.riders?.full_name || '',
          rider_phone: shipment.riders?.phone || '',
          delivery_city: order.delivery_city,
          delivery_state: order.delivery_state,
        });
      } catch (err) {
        console.error('require_return customer email failed:', err?.message || err);
      }
    }
  }

  return jsonResponse(200, { success: true, data: { status: 'return_required' } });
}

// --- Gift local-rider failed deliveries --------------------------------------
// Policy (see services/gift-delivery-attempts.js): free redelivery, then a
// refund after 2 customer-side failed attempts. Gift orders only; marketplace
// failed deliveries keep the existing require_return flow.

async function loadFailedGiftShipment(adminClient, shipmentId) {
  const { data: shipment } = await adminClient
    .from('shipments')
    .select('id, source_type, sub_order_id, status, assigned_rider_id, tracking_number')
    .eq('id', shipmentId)
    .maybeSingle();
  if (!shipment) return { response: jsonResponse(404, { success: false, error: 'Shipment not found' }) };
  if (shipment.status !== 'failed') {
    return { response: jsonResponse(409, { success: false, error: 'Only a failed delivery can be actioned' }) };
  }
  if (shipment.source_type !== 'sub_order') {
    return { response: jsonResponse(400, { success: false, error: 'Only gift deliveries use this action' }) };
  }

  const { data: subOrder } = await adminClient
    .from('sub_orders')
    .select('id, main_order_id, metadata')
    .eq('id', shipment.sub_order_id)
    .maybeSingle();
  if (!isGiftFulfilmentSubOrder(subOrder)) {
    return { response: jsonResponse(400, { success: false, error: 'This action only applies to gift orders' }) };
  }

  const counts = await countFailedAttempts(adminClient, [shipment.id]);
  const attempts = counts.get(shipment.id) || { customerFault: 0, total: 0 };
  return { shipment, subOrder, attempts };
}

async function handleGiftRedeliver(event, body) {
  const auth = await requireAdmin(event, ['admin', 'manager', 'agent']);
  if (auth.errorResponse) return auth.errorResponse;
  const { adminClient } = auth;

  if (!body.shipment_id) return jsonResponse(400, { success: false, error: 'shipment_id is required' });
  const loaded = await loadFailedGiftShipment(adminClient, body.shipment_id);
  if (loaded.response) return loaded.response;
  const { shipment, subOrder, attempts } = loaded;

  if (refundIsDue(attempts.customerFault)) {
    return jsonResponse(409, {
      success: false,
      error: `This gift has had ${GIFT_MAX_CUSTOMER_FAULT_ATTEMPTS} failed delivery attempts, so a refund is due instead of another redelivery`,
    });
  }
  if (!shipment.assigned_rider_id) {
    return jsonResponse(400, { success: false, error: 'No rider is assigned. Assign a rider to redeliver.' });
  }

  // The rider still holds the package, so moving it back to out_for_delivery
  // puts it straight back on their active job.
  const update = { status: 'out_for_delivery', failed_at: null };
  const { error } = await adminClient.from('sub_orders').update(update).eq('id', subOrder.id);
  if (error) return jsonResponse(500, { success: false, error: error.message });

  await syncShipmentBestEffort(adminClient, { subOrderId: subOrder.id, fields: update }, 'admin-delivery-problems gift_redeliver');

  const attemptNo = attempts.customerFault + 1;
  await adminClient.from('tracking_events').insert({
    sub_order_id: subOrder.id,
    shipment_id: shipment.id,
    status: 'out_for_delivery',
    description: `Free redelivery approved by staff (failed attempts so far: ${attempts.customerFault} of ${GIFT_MAX_CUSTOMER_FAULT_ATTEMPTS})`,
    actor_type: 'user',
    source: 'admin',
  });

  await notifyRider(shipment.assigned_rider_id, 'redelivery_approved', { shipment_id: shipment.id });
  const pushResult = await sendRiderPush(adminClient, shipment.assigned_rider_id, {
    title: 'Redeliver this gift',
    message: 'Staff approved another delivery attempt: open the app to continue.',
    type: 'rider_redelivery',
    data: { shipment_id: shipment.id, targetPath: '/' },
  });
  if (!pushResult.success && !pushResult.skipped) console.warn('gift redeliver rider push failed:', pushResult);

  try {
    const { data: order } = await adminClient
      .from('orders')
      .select('id, order_number, customer_name, customer_phone, customer_email, delivery_city, delivery_state')
      .eq('id', subOrder.main_order_id)
      .maybeSingle();
    if (order) {
      const orderRef = extractOrderReference(order) || order.id;
      const deepLink = buildOrderDeepLink(orderRef);
      await sendPushToCustomer(extractCustomerIdFromOrder(order), {
        title: 'We will try delivering your gift again',
        message: `Delivery of order ${orderRef} was not completed. We are arranging another attempt at no extra cost.`,
        type: 'order_update',
        data: { status: 'out_for_delivery', orderReference: String(orderRef), ...(deepLink ? { targetPath: deepLink } : {}) },
      });
    }
  } catch (err) {
    console.warn('gift redeliver customer push failed:', err?.message || err);
  }

  await recordStaffAudit(event, auth.authUser, {
    action: 'GIFT_REDELIVER',
    resource_type: 'shipments',
    resource_id: shipment.id,
    details: { order_id: subOrder.main_order_id, customer_fault_attempts: attempts.customerFault, next_attempt: attemptNo },
  });

  return jsonResponse(200, { success: true, data: { status: 'out_for_delivery', next_attempt: attemptNo } });
}

async function handleGiftRefund(event, body) {
  const auth = await requireAdmin(event, ['admin', 'manager', 'agent']);
  if (auth.errorResponse) return auth.errorResponse;
  const { adminClient } = auth;

  if (!body.shipment_id) return jsonResponse(400, { success: false, error: 'shipment_id is required' });
  const loaded = await loadFailedGiftShipment(adminClient, body.shipment_id);
  if (loaded.response) return loaded.response;
  const { shipment, subOrder, attempts } = loaded;

  if (!refundIsDue(attempts.customerFault)) {
    return jsonResponse(409, {
      success: false,
      error: `A refund applies after ${GIFT_MAX_CUSTOMER_FAULT_ATTEMPTS} failed delivery attempts. This gift has had ${attempts.customerFault}. Use Redeliver instead.`,
    });
  }

  const actorEmail = auth.authUser?.email || auth.profile?.email || null;
  let outcome;
  try {
    outcome = await cancelGiftOrderByStaff(adminClient, {
      orderId: subOrder.main_order_id,
      reason: `Delivery failed after ${GIFT_MAX_CUSTOMER_FAULT_ATTEMPTS} attempts`,
      refund: true,
      actorEmail,
      // The failed delivery already has a rider/shipment; that's the point.
      allowArrangedShipment: true,
    });
  } catch (err) {
    const status = err instanceof GiftCancelError ? err.statusCode : 500;
    return jsonResponse(status, { success: false, error: err?.message || 'Refund failed' });
  }

  // Shipment stays 'failed' so staff can still send the package back with
  // Require Return.
  await adminClient.from('tracking_events').insert({
    sub_order_id: subOrder.id,
    shipment_id: shipment.id,
    status: 'failed',
    description: `Gift cancelled and refunded after ${GIFT_MAX_CUSTOMER_FAULT_ATTEMPTS} failed delivery attempts`,
    actor_type: 'user',
    source: 'admin',
  });

  await recordStaffAudit(event, auth.authUser, {
    action: 'GIFT_REFUND_FAILED_DELIVERY',
    resource_type: 'shipments',
    resource_id: shipment.id,
    details: { ...outcome, customer_fault_attempts: attempts.customerFault },
  });

  sendWebhookEvent('order.updated', {
    order_id: outcome.order_id,
    order_number: outcome.order_number,
    previous_status: outcome.previous_status,
    status: 'cancelled',
  }).catch((e) => console.warn('[admin-delivery-problems] webhook dispatch failed:', e.message));

  return jsonResponse(200, {
    success: true,
    data: { refunded: outcome.refunded, refund_id: outcome.refund_id, refund_error: outcome.refund_error },
  });
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  if (event.httpMethod === 'POST') {
    const body = JSON.parse(event.body || '{}');
    if (body.action === 'require_return') {
      return handleRequireReturn(event);
    }
    if (body.action === 'gift_redeliver') return handleGiftRedeliver(event, body);
    if (body.action === 'gift_refund') return handleGiftRefund(event, body);
    return jsonResponse(400, { success: false, error: 'Unknown action' });
  }

  if (event.httpMethod !== 'GET') return jsonResponse(405, { success: false, error: 'Method not allowed' });

  const auth = await requireAdmin(event, ['admin', 'manager', 'agent', 'viewer']);
  if (auth.errorResponse) return auth.errorResponse;
  const { adminClient } = auth;

  const reason = event.queryStringParameters?.reason || null;
  const includeClosed = event.queryStringParameters?.include_closed === 'true';

  let query = adminClient
    .from('tracking_events')
    .select(
      `id, description, metadata, created_at,
       shipments (
         id, status, tracking_number, assigned_rider_id,
         riders ( full_name, phone ),
         sub_orders ( id, main_order_id, metadata, orders:main_order_id ( id, order_number, order_kind, payment_status, overall_status, customer_name, customer_phone ) ),
         manual_shipments ( id, sender, recipient )
       )`
    )
    .eq("metadata->>'type'", 'problem_report')
    .order('created_at', { ascending: false })
    .limit(200);

  if (reason) query = query.eq("metadata->>'reason'", reason);

  const { data, error } = await query;
  if (error) return jsonResponse(500, { success: false, error: error.message });

  const visible = (data || [])
    .filter((row) => row.shipments) // a shipment could theoretically be deleted after the fact
    .filter((row) => includeClosed || !CLOSED_STATUSES.has(row.shipments.status));

  let giftAttempts = new Map();
  try {
    giftAttempts = await countFailedAttempts(
      adminClient,
      visible.filter((r) => isGiftFulfilmentSubOrder(r.shipments.sub_orders)).map((r) => r.shipments.id)
    );
  } catch (err) {
    console.warn('admin-delivery-problems: failed-attempt count failed:', err?.message || err);
  }

  const rows = visible
    .map((row) => {
      const shipment = row.shipments;
      const subOrder = shipment.sub_orders;
      const manual = shipment.manual_shipments;
      const customerName = subOrder?.orders?.customer_name || manual?.recipient?.name || null;
      const customerPhone = subOrder?.orders?.customer_phone || manual?.recipient?.phone || null;
      const isGift = isGiftFulfilmentSubOrder(subOrder);
      const customerFault = isGift ? giftAttempts.get(shipment.id)?.customerFault || 0 : 0;
      const orderCancelled = subOrder?.orders?.overall_status === 'cancelled';
      return {
        is_gift: isGift,
        gift_failed_attempts: customerFault,
        gift_refund_due: isGift && refundIsDue(customerFault),
        // Already cancelled and refunded: nothing left to redeliver or refund.
        gift_settled: isGift && orderCancelled && subOrder?.orders?.payment_status !== 'paid',
        order_payment_status: subOrder?.orders?.payment_status || null,
        id: row.id,
        reason: row.metadata?.reason || null,
        note: row.metadata?.note || null,
        description: row.description,
        reported_at: row.created_at,
        shipment_id: shipment.id,
        shipment_status: shipment.status,
        tracking_number: shipment.tracking_number,
        order_number: subOrder?.orders?.order_number || null,
        order_id: subOrder?.orders?.id || null,
        manual_shipment_id: manual?.id || null,
        source_type: subOrder ? 'sub_order' : 'manual_shipment',
        customer_name: customerName,
        customer_phone: customerPhone,
        rider_name: shipment.riders?.full_name || null,
        rider_phone: shipment.riders?.phone || null,
      };
    });

  const stats = { total: rows.length };

  return jsonResponse(200, { success: true, data: rows, stats });
}
