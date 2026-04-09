/**
 * GET /api/vendor-my-orders
 * Returns orders (via order_items) belonging to the authenticated vendor.
 * GET /api/vendor-my-orders?id=<sub_order_id> — single order detail
 */
import { corsHeaders, preflightResponse } from './services/cors.js';
import { authenticateVendor } from './services/vendorAuth.js';

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return preflightResponse();
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ success: false, error: 'Method not allowed' }) };

  const { vendor, adminClient, error } = await authenticateVendor(event);
  if (error) return { statusCode: 401, headers: corsHeaders(), body: JSON.stringify({ success: false, error }) };

  const qs     = event.queryStringParameters || {};
  const page   = Math.max(1, parseInt(qs.page || '1', 10));
  const limit  = Math.min(50, parseInt(qs.per_page || '20', 10));
  const status = qs.status || null;

  // ── Single sub_order detail ──────────────────────────────────────────────
  if (qs.id) {
    const { data: so, error: soErr } = await adminClient
      .from('sub_orders')
      .select(`
        id, status, tracking_number, courier_waybill, created_at, updated_at,
        couriers(name, code),
        hubs(name, city, state),
        orders(id, order_number, overall_status, customer_name, customer_email,
               shipping_address, created_at),
        order_items(id, product_name, product_sku, unit_price, quantity, subtotal)
      `)
      .eq('id', qs.id)
      .eq('vendor_id', vendor.id)
      .single();

    if (soErr || !so) return { statusCode: 404, headers: corsHeaders(), body: JSON.stringify({ success: false, error: 'Order not found' }) };
    return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ success: true, data: so }) };
  }

  // ── List sub_orders for this vendor ──────────────────────────────────────
  let query = adminClient
    .from('sub_orders')
    .select(`
      id, status, tracking_number, created_at,
      orders(id, order_number, overall_status, customer_name, created_at, total_amount),
      order_items(subtotal)
    `, { count: 'exact' })
    .eq('vendor_id', vendor.id)
    .order('created_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1);

  if (status) query = query.eq('status', status);

  const { data: subOrders, count, error: qErr } = await query;
  if (qErr) return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ success: false, error: qErr.message }) };

  const orders = (subOrders || []).map(so => ({
    id:           so.id,
    order_number: so.orders?.order_number,
    order_id:     so.orders?.id,
    status:       so.status,
    tracking:     so.tracking_number,
    customer:     so.orders?.customer_name,
    // Sum order_items for this sub_order
    vendor_amount: (so.order_items || []).reduce((s, i) => s + Number(i.subtotal), 0)
      * (1 - Number(vendor.commission_rate || 0) / 100),
    gross_amount: (so.order_items || []).reduce((s, i) => s + Number(i.subtotal), 0),
    created_at:   so.created_at,
  }));

  return {
    statusCode: 200,
    headers: corsHeaders(),
    body: JSON.stringify({
      success: true,
      data: { orders, total: count || 0, page, per_page: limit, total_pages: Math.ceil((count || 0) / limit) },
    }),
  };
}
