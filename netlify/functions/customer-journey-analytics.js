/**
 * GET /api/customer-journey-analytics?from=&to=
 *
 * Aggregate funnel counts (Product Viewed → Checkout Started → Payment
 * Completed) for the admin Customer Journey page. No PII in this response —
 * see customer-journey-drilldown.js for the per-customer breakdown.
 */
import { requireAdmin, jsonResponse, headers } from './services/global-sourcing-utils.js';

const DEFAULT_RANGE_DAYS = 30;

function resolveRange(query) {
  const to = query.to ? new Date(query.to) : new Date();
  const from = query.from
    ? new Date(query.from)
    : new Date(to.getTime() - DEFAULT_RANGE_DAYS * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

function dropOffPct(prevCount, count) {
  if (!prevCount) return null;
  // Clamp negative "drop-off" (e.g. checkout starts from views that predate
  // tracking, or from a session that never fired the view event) to 0 rather
  // than showing a confusing negative percentage.
  return Math.max(0, Math.round(((prevCount - count) / prevCount) * 1000) / 10);
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'GET') return jsonResponse(405, { success: false, error: 'Method not allowed' });

  const { errorResponse, adminClient } = await requireAdmin(event, ['admin', 'manager']);
  if (errorResponse) return errorResponse;

  const query = event.queryStringParameters || {};
  const { from, to } = resolveRange(query);

  try {
    const [viewsRes, ordersRes] = await Promise.all([
      adminClient
        .from('customer_journey_events')
        .select('customer_id, anonymous_id')
        .eq('event_type', 'product_viewed')
        .gte('created_at', from)
        .lte('created_at', to),
      adminClient
        .from('orders')
        .select('id, payment_status')
        .gte('created_at', from)
        .lte('created_at', to),
    ]);

    if (viewsRes.error) throw viewsRes.error;
    if (ordersRes.error) throw ordersRes.error;

    const uniqueViewers = new Set(
      (viewsRes.data || []).map((row) => row.customer_id || row.anonymous_id).filter(Boolean)
    );
    const productViewed = uniqueViewers.size;
    const checkoutStarted = (ordersRes.data || []).length;
    const paymentCompleted = (ordersRes.data || []).filter((o) => o.payment_status === 'paid').length;

    const funnel = [
      { stage: 'Product Viewed', count: productViewed, drop_off_pct: null },
      { stage: 'Checkout Started', count: checkoutStarted, drop_off_pct: dropOffPct(productViewed, checkoutStarted) },
      { stage: 'Payment Completed', count: paymentCompleted, drop_off_pct: dropOffPct(checkoutStarted, paymentCompleted) },
    ];

    return jsonResponse(200, { success: true, data: { funnel, range: { from, to } } });
  } catch (err) {
    console.error('customer-journey-analytics error:', err);
    return jsonResponse(500, { success: false, error: err.message || 'Internal server error' });
  }
}
