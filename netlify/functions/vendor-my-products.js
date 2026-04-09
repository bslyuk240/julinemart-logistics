/**
 * GET /api/vendor-my-products
 * Returns paginated products belonging to the authenticated vendor.
 * Reads images from product_images and prices from product_variations (Supabase).
 */
import { corsHeaders, preflightResponse } from './services/cors.js';
import { authenticateVendor } from './services/vendorAuth.js';

export async function handler(event) {
  const origin = event.headers?.origin || event.headers?.Origin || '';
  if (event.httpMethod === 'OPTIONS') return preflightResponse(origin);
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: 'Method not allowed' }) };

  const { vendor, adminClient, error } = await authenticateVendor(event);
  if (error) return { statusCode: 401, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error }) };

  const qs     = event.queryStringParameters || {};
  const page   = Math.max(1, parseInt(qs.page || '1', 10));
  const limit  = Math.min(50, parseInt(qs.per_page || '20', 10));
  const status = qs.status || null;
  const search = qs.search || null;

  let query = adminClient
    .from('products')
    .select(`
      id, woo_product_id, name, sku, regular_price, sale_price,
      stock_status, stock_quantity, status, type, created_at,
      product_images ( src, position, is_thumbnail ),
      product_variations ( regular_price, sale_price, is_active )
    `, { count: 'exact' })
    .eq('vendor_id', vendor.id)
    .order('created_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1);

  if (status) query = query.eq('status', status);
  if (search) query = query.ilike('name', `%${search}%`);

  const { data: sbProducts, count, error: qErr } = await query;
  if (qErr) return { statusCode: 500, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: qErr.message }) };

  const products = (sbProducts || []).map(p => {
    // Thumbnail from product_images (sorted by position, prefer is_thumbnail)
    const sortedImgs = (p.product_images || []).sort((a, b) => a.position - b.position);
    const thumbnail = sortedImgs.find(img => img.is_thumbnail)?.src || sortedImgs[0]?.src || null;

    // For variable products: derive price from lowest active variation price
    const activeVars = (p.product_variations || []).filter(v => v.is_active !== false);
    const varPrices  = activeVars
      .map(v => Number(v.sale_price || v.regular_price || 0))
      .filter(n => n > 0);
    const minVarPrice = varPrices.length > 0 ? Math.min(...varPrices) : 0;

    const price = Number(p.sale_price || p.regular_price || minVarPrice || 0);

    return {
      id:            p.id,
      woo_id:        p.woo_product_id,
      name:          p.name,
      sku:           p.sku,
      price,
      regular_price: Number(p.regular_price || 0),
      sale_price:    p.sale_price ? Number(p.sale_price) : null,
      stock_status:  p.stock_status,
      stock_qty:     p.stock_quantity,
      status:        p.status,
      type:          p.type,
      image:         thumbnail,
      created_at:    p.created_at,
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
