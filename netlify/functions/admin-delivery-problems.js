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
 *   include_closed defaults to false — hides reports on shipments that are
 *   already delivered/failed/returned, since those don't need action anymore.
 */
import { requireAdmin, jsonResponse, headers } from './services/global-sourcing-utils.js';

const CLOSED_STATUSES = new Set(['delivered', 'failed', 'returned']);

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
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
