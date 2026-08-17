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
import { checkRateLimit } from './services/rate-limit.js';

const DEFAULT_PER_PAGE = 20;
const MAX_PER_PAGE = 100;

/** Short — this endpoint is intentionally fetched with `cache: 'no-store'` by the
 * storefront so edits/unpublishes show up immediately. This only absorbs duplicate
 * bursts (bots, retries), not meaningful staleness. */
const CACHE_CONTROL = 'public, max-age=5, stale-while-revalidate=30';

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

  if (ob === 'seller_quality') {
    return query.order('created_at', { ascending: false });
  }

  return query.order('created_at', { ascending: asc });
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'GET') return jsonResponse(405, { error: 'Method not allowed' });

  const { limited, response } = await checkRateLimit(event, {
    name: 'catalog-products',
    max: 60,
    window: '1 m',
    retryAfterSeconds: 60,
  });
  if (limited) return response;

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
    let nearVendorIds = null;

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

    if (q.near_state || q.near_city || q.near_area || q.pickup_available === 'true' || q.pickup_available === '1') {
      const { data: nearVendors, error: nearErr } = await adminClient
        .from('vendors')
        .select('id, city, state, approved_location_id')
        .eq('is_active', true);
      if (nearErr) throw nearErr;

      const locIds = [...new Set((nearVendors || []).map((v) => v.approved_location_id).filter(Boolean))];
      const locMap = new Map();
      if (locIds.length) {
        const { data: locs } = await adminClient
          .from('approved_vendor_locations')
          .select('id, state, city, public_area, supports_customer_pickup')
          .in('id', locIds);
        for (const l of locs || []) locMap.set(l.id, l);
      }

      let physicalVerified = new Set();
      const vendorUuids = (nearVendors || []).map((v) => v.id);
      if ((q.pickup_available === 'true' || q.pickup_available === '1') && vendorUuids.length) {
        const { data: verifications } = await adminClient
          .from('seller_verifications')
          .select('vendor_id')
          .in('vendor_id', vendorUuids)
          .eq('verification_type', 'physical_store')
          .eq('status', 'approved');
        physicalVerified = new Set((verifications || []).map((r) => r.vendor_id));
      }

      const nearState = q.near_state ? String(q.near_state).trim().toLowerCase() : null;
      const nearCity = q.near_city ? String(q.near_city).trim().toLowerCase() : null;
      const nearArea = q.near_area ? String(q.near_area).trim().toLowerCase() : null;
      const pickupOnly = q.pickup_available === 'true' || q.pickup_available === '1';

      nearVendorIds = (nearVendors || [])
        .filter((v) => {
          const loc = v.approved_location_id ? locMap.get(v.approved_location_id) : null;
          const state = (loc?.state || v.state || '').toLowerCase();
          const city = (loc?.city || v.city || '').toLowerCase();
          const area = (loc?.public_area || '').toLowerCase();
          if (nearState && state !== nearState) return false;
          if (nearCity && city !== nearCity) return false;
          if (nearArea && !area.includes(nearArea)) return false;
          if (pickupOnly) {
            if (!physicalVerified.has(v.id)) return false;
            if (!loc?.supports_customer_pickup) return false;
          }
          return true;
        })
        .map((v) => v.id);

      if (vendorIdResolved && nearVendorIds.length) {
        if (!nearVendorIds.includes(vendorIdResolved)) {
          return jsonResponse(200, { success: true, data: [], meta: emptyListMeta(page, perPage) });
        }
      } else if (!vendorIdResolved && nearVendorIds.length === 0) {
        return jsonResponse(200, { success: true, data: [], meta: emptyListMeta(page, perPage) });
      }
    }

    function applyRowFilters(builder) {
      let b = builder;
      if (status !== 'all') b = b.eq('status', status);
      if (productIdFilter?.length) b = b.in('id', productIdFilter);
      if (vendorIdResolved) b = b.eq('vendor_id', vendorIdResolved);
      else if (nearVendorIds?.length) b = b.in('vendor_id', nearVendorIds);
      if (q.type) b = b.eq('type', q.type);
      if (q.search) {
        // Split into individual terms so "electric fan" matches any product
        // whose name/description contains both words (not necessarily together).
        // Each term is AND-ed; within a term the match can be in name OR description.
        const terms = String(q.search).trim().split(/\s+/).filter(Boolean)
          .map(t => t.replace(/[%_\\]/g, '\\$&')); // escape PG wildcard chars
        for (const term of terms) {
          b = b.or(`name.ilike.%${term}%,short_description.ilike.%${term}%`);
        }
      }
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
         warranty_type, warranty_months,
         average_rating, rating_count, reviews_allowed,
         vendors!vendor_id ( id, store_name, store_slug, woocommerce_vendor_id, logo_url, banner_url, description, email, phone, intro_video_url, seller_quality_score ),
         hubs!hub_id ( id, name, code ),
         product_images ( id, src, alt, position, is_thumbnail, variation_id, photo_source ),
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

    const orderby = String(q.orderby || 'date').toLowerCase();
    if (orderby === 'seller_quality') {
      products.sort((a, b) => {
        const aq = Number(a.vendor?.seller_quality_score ?? -1);
        const bq = Number(b.vendor?.seller_quality_score ?? -1);
        if (bq !== aq) return bq - aq;
        return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
      });
    }

    return {
      statusCode: 200,
      headers: { ...headers, 'Cache-Control': CACHE_CONTROL },
      body: JSON.stringify({
        success: true,
        data: products,
        meta: { page, per_page: perPage, total, total_pages: totalPages },
      }),
    };
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
