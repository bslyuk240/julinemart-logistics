/**
 * GET /api/customer-journey-drilldown?stage=&from=&to=&limit=
 *
 * Per-customer breakdown of who stalled at a given funnel stage. This is the
 * only place PII (name/email/phone) leaves the server for the Customer
 * Journey feature — admin/manager only.
 *
 * stage=product_viewed   -> viewed a product but never started checkout in range
 * stage=checkout_started -> order created but still payment_status='pending'
 */
import { requireAdmin, jsonResponse, headers } from './services/global-sourcing-utils.js';

const DEFAULT_RANGE_DAYS = 30;
const MAX_LIMIT = 200;

function resolveRange(query) {
  const to = query.to ? new Date(query.to) : new Date();
  const from = query.from
    ? new Date(query.from)
    : new Date(to.getTime() - DEFAULT_RANGE_DAYS * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'GET') return jsonResponse(405, { success: false, error: 'Method not allowed' });

  const { errorResponse, adminClient } = await requireAdmin(event, ['admin', 'manager']);
  if (errorResponse) return errorResponse;

  const query = event.queryStringParameters || {};
  const stage = query.stage;
  const { from, to } = resolveRange(query);
  const limit = Math.min(MAX_LIMIT, Number(query.limit) || MAX_LIMIT);

  if (!['product_viewed', 'checkout_started'].includes(stage)) {
    return jsonResponse(400, { success: false, error: 'stage must be product_viewed or checkout_started' });
  }

  try {
    if (stage === 'checkout_started') {
      const { data, error } = await adminClient
        .from('orders')
        .select('id, order_number, customer_name, customer_email, customer_phone, total_amount, created_at')
        .eq('payment_status', 'pending')
        .gte('created_at', from)
        .lte('created_at', to)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return jsonResponse(200, { success: true, data: data || [] });
    }

    // stage === 'product_viewed': customers who viewed a product but never
    // started a checkout (any order, paid or not) in the same window.
    const [viewsRes, ordersRes] = await Promise.all([
      adminClient
        .from('customer_journey_events')
        .select('customer_email, product_id, source_page, created_at, products(name)')
        .eq('event_type', 'product_viewed')
        .not('customer_email', 'is', null)
        .gte('created_at', from)
        .lte('created_at', to)
        .order('created_at', { ascending: false })
        .limit(limit * 3), // over-fetch since some will be excluded below
      adminClient
        .from('orders')
        .select('customer_email')
        .gte('created_at', from)
        .lte('created_at', to),
    ]);
    if (viewsRes.error) throw viewsRes.error;
    if (ordersRes.error) throw ordersRes.error;

    const emailsWithOrders = new Set(
      (ordersRes.data || []).map((o) => (o.customer_email || '').toLowerCase()).filter(Boolean)
    );

    const seen = new Set();
    const stalled = [];
    for (const row of viewsRes.data || []) {
      const email = (row.customer_email || '').toLowerCase();
      if (!email || emailsWithOrders.has(email) || seen.has(email)) continue;
      seen.add(email);
      stalled.push({
        customer_email: row.customer_email,
        product_name: row.products?.name || null,
        source_page: row.source_page,
        viewed_at: row.created_at,
      });
      if (stalled.length >= limit) break;
    }

    return jsonResponse(200, { success: true, data: stalled });
  } catch (err) {
    console.error('customer-journey-drilldown error:', err);
    return jsonResponse(500, { success: false, error: err.message || 'Internal server error' });
  }
}
