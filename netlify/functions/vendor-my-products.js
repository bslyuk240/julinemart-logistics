/**
 * GET /api/vendor-my-products
 * Returns paginated products belonging to the authenticated vendor.
 * Enriches with WooCommerce images/categories using woo_product_id.
 */
import { corsHeaders, preflightResponse } from './services/cors.js';
import { authenticateVendor } from './services/vendorAuth.js';

const WC_BASE   = (process.env.WC_BASE_URL || '').replace(/\/$/, '');
const WC_KEY    = process.env.WC_CONSUMER_KEY || '';
const WC_SECRET = process.env.WC_CONSUMER_SECRET || '';

async function fetchWooProducts(ids) {
  if (!ids.length || !WC_BASE) return [];
  const results = [];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const qs = new URLSearchParams({ include: chunk.join(','), per_page: '100', consumer_key: WC_KEY, consumer_secret: WC_SECRET });
    try {
      const res = await fetch(`${WC_BASE}/products?${qs}`);
      if (res.ok) results.push(...await res.json());
    } catch {}
  }
  return results;
}

export async function handler(event) {
  const origin = event.headers?.origin || event.headers?.Origin || '';
  if (event.httpMethod === 'OPTIONS') return preflightResponse(origin);
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: 'Method not allowed' }) };

  const { vendor, adminClient, error } = await authenticateVendor(event);
  if (error) return { statusCode: 401, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error }) };

  const qs     = event.queryStringParameters || {};
  const page   = Math.max(1, parseInt(qs.page || '1', 10));
  const limit  = Math.min(50, parseInt(qs.per_page || '20', 10));
  const status = qs.status || null; // 'publish' | 'draft' | null = all
  const search = qs.search || null;

  let query = adminClient
    .from('products')
    .select('id, woo_product_id, name, sku, regular_price, sale_price, stock_status, stock_quantity, status, created_at', { count: 'exact' })
    .eq('vendor_id', vendor.id)
    .order('created_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1);

  if (status) query = query.eq('status', status);
  if (search) query = query.ilike('name', `%${search}%`);

  const { data: sbProducts, count, error: qErr } = await query;
  if (qErr) return { statusCode: 500, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: qErr.message }) };

  // Enrich with WC images
  const wooIds = (sbProducts || []).map(p => p.woo_product_id).filter(Boolean);
  const wooProducts = await fetchWooProducts(wooIds);
  const wooById = new Map(wooProducts.map(p => [p.id, p]));

  const products = (sbProducts || []).map(p => {
    const wp = p.woo_product_id ? wooById.get(p.woo_product_id) : null;
    return {
      id:           p.id,
      woo_id:       p.woo_product_id,
      name:         p.name,
      sku:          p.sku,
      price:        Number(p.sale_price || p.regular_price || 0),
      regular_price: Number(p.regular_price || 0),
      sale_price:   p.sale_price ? Number(p.sale_price) : null,
      stock_status: p.stock_status,
      stock_qty:    p.stock_quantity,
      status:       p.status,
      image:        wp?.images?.[0]?.src || null,
      categories:   (wp?.categories || []).map(c => c.name),
      created_at:   p.created_at,
    };
  });

  return {
    statusCode: 200,
    headers: corsHeaders(origin),
    body: JSON.stringify({
      success: true,
      data: { products, total: count || 0, page, per_page: limit, total_pages: Math.ceil((count || 0) / limit) },
    }),
  };
}
