/**
 * GET /api/influencer-my-sales?period=this_month|last_month|all&limit=&offset=
 * Returns the authenticated influencer's own sales history.
 *
 * Field list intentionally excludes admin_commission, vendor_amount (JulineMart's
 * internal margin split) and customer_email — same redaction rule already
 * documented for the `influencers.sales.read` service-API capability in
 * services/capabilityCatalog.js.
 */
import { corsHeaders, preflightResponse } from './services/cors.js';
import { authenticateInfluencer } from './services/influencerAuth.js';

const SALE_FIELDS = 'id, order_number, product_total, shipping_original_cost, shipping_discount_amount, shipping_customer_paid, influencer_commission_rate, influencer_commission_amount, commission_status, sale_date, order_status, payment_date, notes, created_at';

function paginationParams(query) {
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 25));
  const offset = Math.max(0, Number(query.offset) || 0);
  return { limit, offset };
}

function periodToRange(period) {
  const now = new Date();
  if (period === 'this_month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { start: start.toISOString(), end: null };
  }
  if (period === 'last_month') {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 1);
    return { start: start.toISOString(), end: end.toISOString() };
  }
  return { start: null, end: null };
}

export async function handler(event) {
  const origin = event.headers?.origin || event.headers?.Origin || '';
  if (event.httpMethod === 'OPTIONS') return preflightResponse(origin);
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
  }

  const { influencer, adminClient, error } = await authenticateInfluencer(event);
  if (error) return { statusCode: 401, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error }) };

  const query = event.queryStringParameters || {};
  const { limit, offset } = paginationParams(query);
  const { start, end } = periodToRange(query.period);

  let q = adminClient
    .from('influencer_sales')
    .select(SALE_FIELDS, { count: 'exact' })
    .eq('influencer_id', influencer.id)
    .order('sale_date', { ascending: false })
    .range(offset, offset + limit - 1);

  if (start) q = q.gte('sale_date', start);
  if (end) q = q.lt('sale_date', end);

  const { data, error: queryErr, count } = await q;
  if (queryErr) return { statusCode: 500, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: queryErr.message }) };

  return { statusCode: 200, headers: corsHeaders(origin), body: JSON.stringify({ success: true, data, count }) };
}
