/**
 * GET /.netlify/functions/rider-activity?status=all|active|delivered|failed|returned
 * GET /.netlify/functions/rider-activity?id=<shipment_id>  — single-item detail
 *
 * A rider's full delivery history, not just this week's earnings
 * (rider-earnings.js) or the currently-active job (rider-jobs.js). Separate
 * endpoint because it's a genuinely different concern — no earnings math,
 * no job-assignment actions, just "what has this rider done."
 */
import { requireActiveRider, jsonResponse, headers } from './services/requireRider.js';
import { SHIPMENT_LIST_SELECT, fetchSourceDetails, summarizeShipment } from './services/shipmentSummary.js';

const ACTIVE_STATUSES = ['assigned', 'picked_up', 'out_for_delivery'];

const SELECT = `
  id, tracking_number, status, created_at, picked_up_at, out_for_delivery_at, delivered_at, failed_at, rider_payout,
  sub_orders:sub_order_id ( id, orders:main_order_id ( order_number, customer_name, delivery_city ) ),
  manual_shipments:manual_shipment_id ( id, recipient )
`;

function activityTimestamp(row) {
  return row.delivered_at || row.failed_at || row.out_for_delivery_at || row.picked_up_at || row.created_at;
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'GET') return jsonResponse(405, { success: false, error: 'Method not allowed' });

  const session = await requireActiveRider(event);
  if (session.errorResponse) return session.errorResponse;
  const { rider, adminClient } = session;

  const detailId = event.queryStringParameters?.id;
  if (detailId) {
    const { data: row, error: rowErr } = await adminClient
      .from('shipments')
      .select(SHIPMENT_LIST_SELECT)
      .eq('id', detailId)
      .eq('assigned_rider_id', rider.id)
      .maybeSingle();
    if (rowErr) return jsonResponse(500, { success: false, error: rowErr.message });
    if (!row) return jsonResponse(404, { success: false, error: 'Delivery not found' });

    const { subOrderMap, manualMap } = await fetchSourceDetails(adminClient, [row]);
    const detail = summarizeShipment(row, subOrderMap, manualMap);
    if (!detail) return jsonResponse(404, { success: false, error: 'Delivery not found' });

    return jsonResponse(200, { success: true, data: detail });
  }

  const statusFilter = (event.queryStringParameters?.status || 'all').toLowerCase();

  let query = adminClient
    .from('shipments')
    .select(SELECT)
    .eq('assigned_rider_id', rider.id)
    .order('created_at', { ascending: false })
    .limit(100);

  if (statusFilter === 'active') query = query.in('status', ACTIVE_STATUSES);
  else if (['delivered', 'failed', 'returned'].includes(statusFilter)) query = query.eq('status', statusFilter);

  const { data, error } = await query;
  if (error) {
    console.error('rider-activity error:', error);
    return jsonResponse(500, { success: false, error: 'Failed to load activity' });
  }

  const items = (data || []).map((row) => {
    const subOrder = row.sub_orders;
    const manual = row.manual_shipments;
    return {
      id: row.id,
      tracking_number: row.tracking_number,
      order_number: subOrder?.orders?.order_number ?? null,
      status: row.status,
      fee: row.rider_payout ?? 0,
      customer_name: subOrder?.orders?.customer_name || manual?.recipient?.name || null,
      dropoff_city: subOrder?.orders?.delivery_city || manual?.recipient?.city || null,
      timestamp: activityTimestamp(row),
    };
  });

  return jsonResponse(200, { success: true, data: items });
}
