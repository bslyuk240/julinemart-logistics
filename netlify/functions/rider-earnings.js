/**
 * GET /.netlify/functions/rider-earnings
 * Display-only earnings for the authenticated rider — running weekly
 * total, a per-delivery breakdown, and a 7-day daily sparkline. No payout
 * automation; that's explicitly deferred (rider_withdrawals doesn't exist
 * yet).
 */
import { requireActiveRider, jsonResponse, headers } from './services/requireRider.js';

function dayKey(date) {
  return date.toISOString().slice(0, 10);
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'GET') return jsonResponse(405, { success: false, error: 'Method not allowed' });

  const session = await requireActiveRider(event);
  if (session.errorResponse) return session.errorResponse;
  const { rider, adminClient } = session;

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
  sevenDaysAgo.setHours(0, 0, 0, 0);

  const { data: deliveries, error } = await adminClient
    .from('sub_orders')
    .select('id, tracking_number, delivered_at, allocated_shipping_fee, courier_charge, orders:main_order_id (order_number)')
    .eq('assigned_rider_id', rider.id)
    .eq('status', 'delivered')
    .gte('delivered_at', sevenDaysAgo.toISOString())
    .order('delivered_at', { ascending: false });

  if (error) {
    console.error('rider-earnings error:', error);
    return jsonResponse(500, { success: false, error: 'Failed to load earnings' });
  }

  const sparklineMap = new Map();
  for (let i = 0; i < 7; i++) {
    const d = new Date(sevenDaysAgo);
    d.setDate(d.getDate() + i);
    sparklineMap.set(dayKey(d), 0);
  }

  let weeklyTotal = 0;
  const breakdown = (deliveries || []).map((row) => {
    const fee = Number(row.allocated_shipping_fee ?? row.courier_charge ?? 0) || 0;
    weeklyTotal += fee;
    const key = dayKey(new Date(row.delivered_at));
    if (sparklineMap.has(key)) sparklineMap.set(key, sparklineMap.get(key) + fee);
    return {
      id: row.id,
      tracking_number: row.tracking_number,
      order_number: row.orders?.order_number ?? null,
      fee,
      delivered_at: row.delivered_at,
    };
  });

  const sparkline = Array.from(sparklineMap.entries()).map(([date, amount]) => ({ date, amount }));

  return jsonResponse(200, {
    success: true,
    data: { weekly_total: weeklyTotal, delivery_count: breakdown.length, breakdown, sparkline },
  });
}
