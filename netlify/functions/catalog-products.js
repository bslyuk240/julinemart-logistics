/**
 * GET /api/catalog-products
 *
 * Serves the product catalog from Supabase.
 * Supports: page, per_page, category (slug), tag (slug), vendor_id, search, type, status,
 * orderby (date|price|popularity|rating), order (asc|desc)
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

function emptyListMeta(page, perPage) {
  return { page, per_page: perPage, total: 0, total_pages: 0 };
}

/** Match list ordering to Woo-style orderby (products table has no total_sales / average_rating yet). */
function applyCatalogOrdering(query, orderbyRaw, orderRaw) {
  const ob = String(orderbyRaw || 'date').toLowerCase();
  const asc = String(orderRaw || 'desc').toLowerCase() === 'asc';

  if (ob === 'price') {
    return query
      .order('regular_price', { ascending: asc, nullsFirst: false })
      .order('sale_price', { ascending: asc, nullsFirst: false })
      .order('created_at', { ascending: false });
  }

  if (ob === 'popularity' || ob === 'rating') {
    // Columns not on products Row yet — keep deterministic fallback
    return query.order('created_at', { ascending: false });
  }

  return query.order('created_at', { ascending: asc });
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'GET') return jsonResponse(405, { error: 'Method not allowed' });

  if (!adminClient) return jsonResponse(503, { error: 'Database not configured' });

  const q = event.queryStringParameters || {};
  const page = Math.max(Number(q.page || 1), 1);
  const perPage = Math.min(Math.max(Number(q.per_page || DEFAULT_PER_PAGE), 1), MAX_PER_PAGE);
  const offset = (page - 1) * perPage;
  const status = q.status || 'published';

  /** Collect all product_id values for a junction table (Supabase default page size can truncate). */
  async function allProductIdsForJunction(table, fkColumn, fkValue) {
    const pageSize = 1000;
    const ids = [];
    let from = 0;
    for (;;) {
      const { data: rows, error: mapErr } = await adminClient
        .from(table)
        .select('product_id')
        .eq(fkColumn, fkValue)
        .range(from, from + pageSize - 1);
      if (mapErr) throw mapErr;
      if (!rows?.length) break;
      for (const r of rows) ids.push(r.product_id);
      if (rows.length < pageSize) break;
      from += pageSize;
    }
    return ids;
  }

  try {
    let productIdFilter = null;
    let vendorIdResolved = null;

    if (q.category) {
      const categorySlug = decodeURIComponent(String(q.category).trim());
      const { data: cat } = await adminClient
        .from('categories')
        .select('id')
        .eq('slug', categorySlug)
        .maybeSingle();
      if (!cat) {
        return jsonResponse(200, { success: true, data: [], meta: emptyListMeta(page, perPage) });
      }
      const ids = await allProductIdsForJunction('product_category_map', 'category_id', cat.id);
      if (ids.length === 0) {
        return jsonResponse(200, { success: true, data: [], meta: emptyListMeta(page, perPage) });
      }
      productIdFilter = ids;
    }

    if (q.tag) {
      const tagSlug = decodeURIComponent(String(q.tag).trim());
      const { data: tag } = await adminClient
        .from('tags')
        .select('id')
        .eq('slug', tagSlug)
        .maybeSingle();
      if (!tag) {
        return jsonResponse(200, { success: true, data: [], meta: emptyListMeta(page, perPage) });
      }
      const ids = await allProductIdsForJunction('product_tag_map', 'tag_id', tag.id);
      if (ids.length === 0) {
        return jsonResponse(200, { success: true, data: [], meta: emptyListMeta(page, perPage) });
      }
      if (productIdFilter) {
        const set = new Set(ids);
        productIdFilter = productIdFilter.filter((id) => set.has(id));
      } else {
        productIdFilter = ids;
      }
      if (productIdFilter.length === 0) {
        return jsonResponse(200, { success: true, data: [], meta: emptyListMeta(page, perPage) });
      }
    }

    if (q.vendor_id) {
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(q.vendor_id);
      if (isUUID) {
        vendorIdResolved = q.vendor_id;
      } else {
        const { data: vendor } = await adminClient
          .from('vendors')
          .select('id')
          .eq('woocommerce_vendor_id', q.vendor_id)
          .maybeSingle();
        if (!vendor) {
          return jsonResponse(200, { success: true, data: [], meta: emptyListMeta(page, perPage) });
        }
        vendorIdResolved = vendor.id;
      }
    } else if (q.woo_vendor_id) {
      const { data: vendor } = await adminClient
        .from('vendors')
        .select('id')
        .eq('woocommerce_vendor_id', q.woo_vendor_id)
        .maybeSingle();
      if (!vendor) {
        return jsonResponse(200, { success: true, data: [], meta: emptyListMeta(page, perPage) });
      }
      vendorIdResolved = vendor.id;
    }

    function applyRowFilters(builder) {
      let b = builder;
      if (status !== 'all') b = b.eq('status', status);
      if (productIdFilter?.length) b = b.in('id', productIdFilter);
      if (vendorIdResolved) b = b.eq('vendor_id', vendorIdResolved);
      if (q.type) b = b.eq('type', q.type);
      if (q.search) b = b.ilike('name', `%${q.search}%`);
      return b;
    }

    const { count: headCount, error: countErr } = await applyRowFilters(
      adminClient.from('products').select('id', { count: 'exact', head: true })
    );
    if (countErr) {
      return jsonResponse(500, { success: false, error: countErr.message });
    }

    const total = headCount ?? 0;
    const totalPages = total > 0 ? Math.ceil(total / perPage) : 0;

    let dataQuery = adminClient
      .from('products')
      .select(
        `id, woo_product_id, name, slug, short_description, status, type,
         regular_price, sale_price, sku, stock_status, manage_stock, stock_quantity,
         ships_from_abroad, is_virtual, sourcing_meta, seo_title, created_at,
         vendors!vendor_id ( id, store_name, store_slug, woocommerce_vendor_id ),
         hubs!hub_id ( id, name, code ),
         product_images ( id, src, alt, position, is_thumbnail, variation_id ),
         product_variations ( id, regular_price, sale_price, is_active, attributes ),
         product_category_map ( categories ( id, name, slug ) ),
         product_tag_map ( tags ( id, name, slug ) )`
      );

    dataQuery = applyRowFilters(dataQuery);
    dataQuery = applyCatalogOrdering(dataQuery, q.orderby, q.order);
    dataQuery = dataQuery.range(offset, offset + perPage - 1);

    const { data, error } = await dataQuery;

    if (error) {
      return jsonResponse(500, { success: false, error: error.message });
    }

    const products = (data || []).map(normalizeProduct);

    return jsonResponse(200, {
      success: true,
      data: products,
      meta: { page, per_page: perPage, total, total_pages: totalPages },
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
  const activeVars = (p.product_variations || []).filter((v) => v.is_active !== false);
  const varPrices = activeVars
    .map((v) => Number(v.sale_price || v.regular_price || 0))
    .filter((n) => n > 0);
  const minVarPrice = varPrices.length > 0 ? Math.min(...varPrices) : 0;
  const maxVarPrice = varPrices.length > 0 ? Math.max(...varPrices) : 0;

  return {
    ...p,
    vendor: p.vendors || null,
    hub: p.hubs || null,
    images: (p.product_images || [])
      .filter((img) => !img.variation_id)
      .sort((a, b) => a.position - b.position),
    variations: activeVars,
    // Computed price fields for convenience
    price: Number(p.sale_price || p.regular_price || minVarPrice || 0),
    min_price: minVarPrice,
    max_price: maxVarPrice,
    categories: (p.product_category_map || []).map((r) => r.categories).filter(Boolean),
    tags: (p.product_tag_map || []).map((r) => r.tags).filter(Boolean),
    // Remove raw relation keys
    vendors: undefined,
    hubs: undefined,
    product_images: undefined,
    product_variations: undefined,
    product_category_map: undefined,
    product_tag_map: undefined,
  };
}
