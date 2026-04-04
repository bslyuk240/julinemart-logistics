/**
 * GET /api/catalog-products
 *
 * Serves the product catalog from Supabase.
 * Supports: page, per_page, category (slug), tag (slug), vendor_id, search, type, status
 *
 * Returns products with vendor, hub, images, categories, tags.
 */

import {
  headers,
  jsonResponse,
  adminClient,
} from './services/global-sourcing-utils.js';

const DEFAULT_PER_PAGE = 20;
const MAX_PER_PAGE = 100;

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'GET') return jsonResponse(405, { error: 'Method not allowed' });

  if (!adminClient) return jsonResponse(503, { error: 'Database not configured' });

  const q = event.queryStringParameters || {};
  const page = Math.max(Number(q.page || 1), 1);
  const perPage = Math.min(Math.max(Number(q.per_page || DEFAULT_PER_PAGE), 1), MAX_PER_PAGE);
  const offset = (page - 1) * perPage;
  const status = q.status || 'published';

  try {
    let query = adminClient
      .from('products')
      .select(
        `id, woo_product_id, name, slug, short_description, status, type,
         regular_price, sale_price, sku, stock_status, manage_stock, stock_quantity,
         ships_from_abroad, is_virtual, sourcing_meta, seo_title, created_at,
         vendors!vendor_id ( id, store_name, store_slug, woocommerce_vendor_id ),
         hubs!hub_id ( id, name, code ),
         product_images ( id, src, alt, position, is_thumbnail, variation_id ),
         product_category_map ( categories ( id, name, slug ) ),
         product_tag_map ( tags ( id, name, slug ) )`,
        { count: 'exact' }
      );

    // 'all' skips the status filter — used by admin product list
    if (status !== 'all') query = query.eq('status', status);
    query = query
      .order('created_at', { ascending: false })
      .range(offset, offset + perPage - 1);

    // Category filter by slug
    if (q.category) {
      const { data: cat } = await adminClient
        .from('categories')
        .select('id')
        .eq('slug', q.category)
        .maybeSingle();
      if (!cat) return jsonResponse(200, { success: true, data: [], meta: { page, per_page: perPage, total: 0, total_pages: 0 } });
      // Need product IDs in this category
      const { data: catMap } = await adminClient
        .from('product_category_map')
        .select('product_id')
        .eq('category_id', cat.id);
      const ids = (catMap || []).map((r) => r.product_id);
      if (ids.length === 0) return jsonResponse(200, { success: true, data: [], meta: { page, per_page: perPage, total: 0, total_pages: 0 } });
      query = query.in('id', ids);
    }

    // Tag filter by slug
    if (q.tag) {
      const { data: tag } = await adminClient
        .from('tags')
        .select('id')
        .eq('slug', q.tag)
        .maybeSingle();
      if (!tag) return jsonResponse(200, { success: true, data: [], meta: { page, per_page: perPage, total: 0, total_pages: 0 } });
      const { data: tagMap } = await adminClient
        .from('product_tag_map')
        .select('product_id')
        .eq('tag_id', tag.id);
      const ids = (tagMap || []).map((r) => r.product_id);
      if (ids.length === 0) return jsonResponse(200, { success: true, data: [], meta: { page, per_page: perPage, total: 0, total_pages: 0 } });
      query = query.in('id', ids);
    }

    // Vendor filter — by Supabase UUID or by WooCommerce vendor ID
    if (q.vendor_id) {
      query = query.eq('vendor_id', q.vendor_id);
    } else if (q.woo_vendor_id) {
      const { data: vendor } = await adminClient
        .from('vendors')
        .select('id')
        .eq('woocommerce_vendor_id', q.woo_vendor_id)
        .maybeSingle();
      if (!vendor) return jsonResponse(200, { success: true, data: [], meta: { page, per_page: perPage, total: 0, total_pages: 0 } });
      query = query.eq('vendor_id', vendor.id);
    }

    // Type filter
    if (q.type) {
      query = query.eq('type', q.type);
    }

    // Text search (name)
    if (q.search) {
      query = query.ilike('name', `%${q.search}%`);
    }

    const { data, error, count } = await query;

    if (error) {
      return jsonResponse(500, { success: false, error: error.message });
    }

    // Normalize nested relations
    const products = (data || []).map(normalizeProduct);
    const totalPages = count ? Math.ceil(count / perPage) : 0;

    return jsonResponse(200, {
      success: true,
      data: products,
      meta: { page, per_page: perPage, total: count || 0, total_pages: totalPages },
    });
  } catch (error) {
    return jsonResponse(error?.statusCode || 500, {
      success: false,
      error: 'Failed to load catalog products',
      message: error?.message || String(error),
    });
  }
}

function normalizeProduct(p) {
  return {
    ...p,
    vendor: p.vendors || null,
    hub: p.hubs || null,
    images: (p.product_images || [])
      .filter((img) => !img.variation_id)
      .sort((a, b) => a.position - b.position),
    categories: (p.product_category_map || []).map((r) => r.categories).filter(Boolean),
    tags: (p.product_tag_map || []).map((r) => r.tags).filter(Boolean),
    // Remove raw relation keys
    vendors: undefined,
    hubs: undefined,
    product_images: undefined,
    product_category_map: undefined,
    product_tag_map: undefined,
  };
}
