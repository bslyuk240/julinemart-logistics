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
import { sendPushToCustomer } from './services/pushNotifications.js';

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
    .select('id, source_type, sub_order_id, manual_shipment_id, status, assigned_rider_id')
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
    const pushResult = await sendPushToCustomer(shipment.assigned_rider_id, {
      title: 'Return required',
      message: 'A package needs to go back — open the app for details.',
      type: 'rider_job_assigned',
      data: { shipment_id, targetPath: '/' },
    });
    if (!pushResult.success && !pushResult.skipped) {
      console.warn('require_return push failed:', pushResult);
    }
  }

  return jsonResponse(200, { success: true, data: { status: 'return_required' } });
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  if (event.httpMethod === 'POST') {
    const body = JSON.parse(event.body || '{}');
    if (body.action === 'require_return') {
      return handleRequireReturn(event);
    }
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
         sub_orders ( id, main_order_id, orders:main_order_id ( id, order_number, customer_name, customer_phone ) ),
         manual_shipments ( id, sender, recipient )
       )`
    )
    .eq("metadata->>'type'", 'problem_report')
    .order('created_at', { ascending: false })
    .limit(200);

  if (reason) query = query.eq("metadata->>'reason'", reason);

  const { data, error } = await query;
  if (error) return jsonResponse(500, { success: false, error: error.message });

  const rows = (data || [])
    .filter((row) => row.shipments) // a shipment could theoretically be deleted after the fact
    .filter((row) => includeClosed || !CLOSED_STATUSES.has(row.shipments.status))
    .map((row) => {
      const shipment = row.shipments;
      const subOrder = shipment.sub_orders;
      const manual = shipment.manual_shipments;
      const customerName = subOrder?.orders?.customer_name || manual?.recipient?.name || null;
      const customerPhone = subOrder?.orders?.customer_phone || manual?.recipient?.phone || null;
      return {
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
