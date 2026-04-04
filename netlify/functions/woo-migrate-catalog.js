/**
 * WooCommerce → Supabase catalog migration runner.
 *
 * Phases:
 *   taxonomy  — sync categories, tags, seed attributes (one-shot, fast)
 *   products  — sync one page of published products (call with ?phase=products&page=N)
 *   variations— sync variations for one page of variable products (?phase=variations&page=N)
 *
 * Each products/variations call processes 20 items and returns
 * { page, total_pages, processed, errors, has_more } so the caller can loop.
 *
 * POST /api/woo-migrate-catalog?phase=taxonomy
 * POST /api/woo-migrate-catalog?phase=products&page=1
 * POST /api/woo-migrate-catalog?phase=variations&page=1
 */

import { createClient } from '@supabase/supabase-js';
import {
  extractMetaValue,
  extractGlobalSourcingFromMeta,
  headers,
  jsonResponse,
  requestWoo,
  requireAdmin,
  GLOBAL_SOURCING_ALLOWED_ROLES,
} from './services/global-sourcing-utils.js';

const PER_PAGE = 20; // safe for IONOS shared hosting
const VAR_PER_PAGE = 10; // fewer variable products per page — each makes a WC call
const VAR_INTER_DELAY_MS = 2000; // 2s between each product's variation fetch

/**
 * Migration target client — reads from MIGRATION_SUPABASE_* env vars.
 * Falls back to the default SUPABASE_* vars when those aren't set
 * (i.e. when the target IS production).
 */
function getMigrationClient() {
  const url =
    process.env.MIGRATION_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    '';
  const key =
    process.env.MIGRATION_SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.VITE_SUPABASE_SERVICE_ROLE_KEY ||
    '';
  if (!url || !key) throw new Error('Migration Supabase credentials not configured');
  return createClient(url, key);
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function slugify(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function mapStatus(wcStatus) {
  if (wcStatus === 'publish') return 'published';
  if (wcStatus === 'trash') return 'trash';
  if (wcStatus === 'private') return 'archived';
  return 'draft';
}

function parsePrice(val) {
  const n = parseFloat(val);
  return isFinite(n) ? n : null;
}

function parseBool(val) {
  if (typeof val === 'boolean') return val;
  if (val === '1' || val === 'yes' || val === 'true') return true;
  return false;
}

// Extract all CJ / global-sourcing fields into sourcing_meta JSONB
function buildSourcingMeta(metaData) {
  if (!Array.isArray(metaData) || metaData.length === 0) return null;

  const gs = extractGlobalSourcingFromMeta ? extractGlobalSourcingFromMeta(metaData) : {};

  // Supplement with any raw keys not covered by extractGlobalSourcingFromMeta
  const raw = {};
  const extraKeys = [
    '_cj_pid', '_cj_vid', '_supplier_product_id', '_supplier_variant_id',
    '_supplier_source', '_global_sourcing_provider', '_global_sourcing_tag',
    '_origin_country', '_ships_from_abroad', '_fulfillment_mode',
    '_global_sourcing_pricing_mode',
    '_estimated_inbound_days_min', '_estimated_inbound_days_max',
    '_supplier_price_snapshot', '_supplier_price_snapshot_usd',
    '_inbound_shipping_snapshot_usd', '_landed_cost_snapshot',
    '_landed_cost_snapshot_usd', '_final_price_snapshot_ngn',
    '_usd_to_ngn_rate_snapshot', '_exchange_rate_snapshot',
  ];
  for (const key of extraKeys) {
    const val = extractMetaValue(metaData, [key]);
    if (val != null && val !== '') {
      const clean = key.replace(/^_/, '');
      raw[clean] = val;
    }
  }

  const merged = { ...raw, ...gs };
  return Object.keys(merged).length > 0 ? merged : null;
}

// ─── phase: taxonomy ──────────────────────────────────────────────────────────

async function syncTaxonomy(adminClient) {
  const errors = [];

  // 1. Fetch ALL categories from WooCommerce in one shot (78 fits in 100)
  const allWcCats = await requestWoo(`/products/categories?per_page=100&page=1`);
  const wcCats = Array.isArray(allWcCats) ? allWcCats : [];

  // Upsert all categories (without parent_id first — avoids FK ordering issues)
  const catRows = wcCats.map((c) => ({
    woo_term_id: c.id,
    name: c.name || '',
    slug: c.slug || slugify(c.name),
    description: c.description || null,
    image_url: c.image?.src || null,
    display_order: c.menu_order || 0,
  }));

  const { error: catErr } = await adminClient
    .from('categories')
    .upsert(catRows, { onConflict: 'woo_term_id', ignoreDuplicates: false });
  if (catErr) errors.push(`categories upsert: ${catErr.message}`);

  // 2. Wire parent_id — fetch all rows back in one query, build map, batch update
  const catsWithParent = wcCats.filter((c) => c.parent && c.parent !== 0);
  if (catsWithParent.length > 0) {
    const allWooIds = wcCats.map((c) => c.id);
    const { data: sbCats } = await adminClient
      .from('categories')
      .select('id, woo_term_id')
      .in('woo_term_id', allWooIds);

    // Build woo_term_id → supabase uuid map
    const wooToUuid = new Map((sbCats || []).map((r) => [r.woo_term_id, r.id]));

    // Update parent_id using woo_term_id filter — avoids upsert NOT NULL issues
    // Run in parallel batches of 10 to stay fast without overwhelming Supabase
    const parentPairs = catsWithParent
      .map((c) => ({ childWooId: c.id, parentUuid: wooToUuid.get(c.parent) }))
      .filter((r) => r.parentUuid);

    const BATCH = 10;
    for (let i = 0; i < parentPairs.length; i += BATCH) {
      const chunk = parentPairs.slice(i, i + BATCH);
      await Promise.all(chunk.map(({ childWooId, parentUuid }) =>
        adminClient
          .from('categories')
          .update({ parent_id: parentUuid })
          .eq('woo_term_id', childWooId)
      ));
    }
    if (parentPairs.length === 0) {
      // no-op, all top-level
    }
  }

  // 3. Tags — single fetch (15 tags, fits in 100)
  const allWcTags = await requestWoo(`/products/tags?per_page=100&page=1`);
  const wcTags = Array.isArray(allWcTags) ? allWcTags : [];
  const tagRows = wcTags.map((t) => ({
    woo_term_id: t.id,
    name: t.name || '',
    slug: t.slug || slugify(t.name),
  }));
  if (tagRows.length > 0) {
    const { error: tagErr } = await adminClient
      .from('tags')
      .upsert(tagRows, { onConflict: 'woo_term_id', ignoreDuplicates: false });
    if (tagErr) errors.push(`tags upsert: ${tagErr.message}`);
  }

  // 4. Seed the 2 global attributes
  const { error: attrErr } = await adminClient
    .from('product_attributes')
    .upsert([
      { name: 'Colour', slug: 'colour', type: 'select', display_order: 1 },
      { name: 'Size',   slug: 'size',   type: 'select', display_order: 2 },
    ], { onConflict: 'slug', ignoreDuplicates: false });
  if (attrErr) errors.push(`attributes: ${attrErr.message}`);

  return {
    success: errors.length === 0,
    categories: catRows.length,
    tags: tagRows.length,
    attributes: 2,
    errors,
  };
}

// ─── phase: products ──────────────────────────────────────────────────────────

async function syncProducts(adminClient, page) {
  const errors = [];

  // Pre-fetch lookup maps from Supabase
  const [vendorRes, hubRes, catRes, tagRes, attrRes] = await Promise.all([
    adminClient.from('vendors').select('id, woocommerce_vendor_id'),
    adminClient.from('hubs').select('id'),
    adminClient.from('categories').select('id, woo_term_id'),
    adminClient.from('tags').select('id, woo_term_id'),
    adminClient.from('product_attributes').select('id, slug'),
  ]);

  const vendorMap = new Map((vendorRes.data || []).map((v) => [String(v.woocommerce_vendor_id), v.id]));
  const hubSet = new Set((hubRes.data || []).map((h) => h.id));
  const catMap = new Map((catRes.data || []).map((c) => [c.woo_term_id, c.id]));
  const tagMap = new Map((tagRes.data || []).map((t) => [t.woo_term_id, t.id]));
  const attrMap = new Map((attrRes.data || []).map((a) => [a.slug, a.id]));

  // Fetch products page from WooCommerce
  const fields = [
    'id', 'name', 'slug', 'description', 'short_description', 'status', 'type',
    'regular_price', 'sale_price', 'sku', 'weight', 'dimensions',
    'manage_stock', 'stock_quantity', 'stock_status',
    'virtual', 'downloadable', 'sold_individually',
    'images', 'categories', 'tags', 'attributes', 'meta_data',
    'date_created',
  ].join(',');

  const wcProducts = await requestWoo(
    `/products?status=publish&per_page=${PER_PAGE}&page=${page}&orderby=id&order=asc&_fields=${fields}`
  );
  if (!Array.isArray(wcProducts)) {
    return { success: false, error: 'WooCommerce returned non-array', page, has_more: false };
  }

  // Get total count from a lightweight head request
  let totalProducts = 0;
  try {
    const countResp = await requestWoo(`/products?status=publish&per_page=1&page=1&_fields=id`);
    // WC doesn't return total in body — we'll estimate from page size
    totalProducts = wcProducts.length < PER_PAGE ? (page - 1) * PER_PAGE + wcProducts.length : null;
  } catch (_) {}

  let processed = 0;

  for (const p of wcProducts) {
    try {
      const meta = Array.isArray(p.meta_data) ? p.meta_data : [];

      // Vendor resolution
      const wooVendorId = extractMetaValue(meta, ['_wcfm_product_author', '_wcfm_vendor_id', '_vendor_id'])
        || (p.post_author ? String(p.post_author) : null);
      const vendorId = wooVendorId ? (vendorMap.get(String(wooVendorId)) || null) : null;

      // Hub resolution
      const hubId = extractMetaValue(meta, ['_julinemart_hub_id', '_receiving_hub_id', '_hub_id', 'hub_id']);
      const resolvedHubId = hubId && hubSet.has(hubId) ? hubId : null;

      // Ships from abroad
      const sfaRaw = extractMetaValue(meta, ['_ships_from_abroad', 'ships_from_abroad']);
      const shipsFromAbroad = parseBool(sfaRaw);

      const productRow = {
        woo_product_id: p.id,
        name: p.name || '',
        slug: p.slug || slugify(p.name),
        description: p.description || null,
        short_description: p.short_description || null,
        status: mapStatus(p.status),
        type: p.type === 'variable' ? 'variable' : 'simple',
        regular_price: parsePrice(p.regular_price),
        sale_price: parsePrice(p.sale_price),
        sku: p.sku || null,
        weight: parsePrice(p.weight),
        length: parsePrice(p.dimensions?.length),
        width: parsePrice(p.dimensions?.width),
        height: parsePrice(p.dimensions?.height),
        manage_stock: !!p.manage_stock,
        stock_quantity: p.stock_quantity ?? null,
        stock_status: p.stock_status || 'instock',
        is_virtual: !!p.virtual,
        is_downloadable: !!p.downloadable,
        ships_from_abroad: shipsFromAbroad,
        sold_individually: !!p.sold_individually,
        vendor_id: vendorId,
        hub_id: resolvedHubId,
        sourcing_meta: buildSourcingMeta(meta),
        seo_title: extractMetaValue(meta, ['_aioseop_title', '_aioseo_title']) || null,
        seo_description: extractMetaValue(meta, ['_aioseop_description', '_aioseo_description']) || null,
      };

      const { data: upserted, error: prodErr } = await adminClient
        .from('products')
        .upsert(productRow, { onConflict: 'woo_product_id' })
        .select('id')
        .single();

      if (prodErr) {
        errors.push(`product woo_id=${p.id}: ${prodErr.message}`);
        continue;
      }
      const productUuid = upserted.id;

      // Images
      const images = (p.images || []).filter(Boolean);
      if (images.length > 0) {
        await adminClient.from('product_images').delete().eq('product_id', productUuid).is('variation_id', null);
        const imgRows = images.map((img, i) => ({
          product_id: productUuid,
          src: img.src,
          alt: img.alt || '',
          position: i,
          is_thumbnail: i === 0,
        }));
        await adminClient.from('product_images').insert(imgRows);
      }

      // Category map
      const catIds = (p.categories || [])
        .map((c) => catMap.get(c.id))
        .filter(Boolean);
      if (catIds.length > 0) {
        await adminClient.from('product_category_map').delete().eq('product_id', productUuid);
        await adminClient.from('product_category_map').insert(
          catIds.map((cid) => ({ product_id: productUuid, category_id: cid }))
        );
      }

      // Tag map
      const tagIds = (p.tags || [])
        .map((t) => tagMap.get(t.id))
        .filter(Boolean);
      if (tagIds.length > 0) {
        await adminClient.from('product_tag_map').delete().eq('product_id', productUuid);
        await adminClient.from('product_tag_map').insert(
          tagIds.map((tid) => ({ product_id: productUuid, tag_id: tid }))
        );
      }

      // Attribute map (variation-driving attributes only)
      const wcAttrs = (p.attributes || []).filter((a) => a.variation);
      if (wcAttrs.length > 0) {
        await adminClient.from('product_attribute_map').delete().eq('product_id', productUuid);
        const attrRows = wcAttrs
          .map((a) => {
            const attrSlug = slugify(a.name);
            const attrId = attrMap.get(attrSlug);
            if (!attrId) return null;
            return {
              product_id: productUuid,
              attribute_id: attrId,
              options: a.options || [],
              is_variation: true,
              display_order: a.position || 0,
            };
          })
          .filter(Boolean);
        if (attrRows.length > 0) {
          await adminClient.from('product_attribute_map').insert(attrRows);
        }
      }

      processed++;
    } catch (e) {
      errors.push(`product woo_id=${p.id}: ${e.message}`);
    }
  }

  const hasMore = wcProducts.length === PER_PAGE;

  return {
    success: true,
    phase: 'products',
    page,
    per_page: PER_PAGE,
    processed,
    errors,
    has_more: hasMore,
  };
}

// ─── phase: variations ────────────────────────────────────────────────────────

async function syncVariations(adminClient, page) {
  const errors = [];

  // Load vendor + hub maps
  const [vendorRes, hubRes] = await Promise.all([
    adminClient.from('vendors').select('id, woocommerce_vendor_id'),
    adminClient.from('hubs').select('id'),
  ]);
  const vendorMap = new Map((vendorRes.data || []).map((v) => [String(v.woocommerce_vendor_id), v.id]));
  const hubSet = new Set((hubRes.data || []).map((h) => h.id));

  // Page through variable products in Supabase
  const offset = (page - 1) * VAR_PER_PAGE;
  const { data: variableProducts, error: vpErr, count } = await adminClient
    .from('products')
    .select('id, woo_product_id', { count: 'exact' })
    .eq('type', 'variable')
    .not('woo_product_id', 'is', null)
    .order('woo_product_id', { ascending: true })
    .range(offset, offset + VAR_PER_PAGE - 1);

  if (vpErr) return { success: false, error: vpErr.message, page };

  let processed = 0;

  for (const product of (variableProducts || [])) {
    try {
      let wcVars;
      try {
        wcVars = await requestWoo(
          `/products/${product.woo_product_id}/variations?per_page=100&_fields=id,sku,regular_price,sale_price,stock_quantity,stock_status,manage_stock,attributes,image,meta_data`
        );
      } catch (wcErr) {
        // WooCommerce returned HTML error page (server overloaded) — skip this product
        errors.push(`woo_id=${product.woo_product_id}: WC error — ${wcErr.message?.slice(0, 80)}`);
        await new Promise((r) => setTimeout(r, VAR_INTER_DELAY_MS));
        continue;
      }
      if (!Array.isArray(wcVars)) {
        errors.push(`woo_id=${product.woo_product_id}: WC returned non-array`);
        continue;
      }

      for (const v of wcVars) {
        const meta = Array.isArray(v.meta_data) ? v.meta_data : [];

        const wooVendorId = extractMetaValue(meta, ['_wcfm_product_author', '_wcfm_vendor_id', '_vendor_id']);
        const vendorId = wooVendorId ? (vendorMap.get(String(wooVendorId)) || null) : null;

        const hubId = extractMetaValue(meta, ['_julinemart_hub_id', '_receiving_hub_id', '_hub_id', 'hub_id']);
        const resolvedHubId = hubId && hubSet.has(hubId) ? hubId : null;

        // attributes: [{name: "Colour", option: "Red"}, ...]
        const attrs = {};
        for (const a of (v.attributes || [])) {
          if (a.name && a.option) {
            attrs[slugify(a.name)] = a.option;
          }
        }

        const varRow = {
          product_id: product.id,
          woo_variation_id: v.id,
          sku: v.sku || null,
          regular_price: parsePrice(v.regular_price),
          sale_price: parsePrice(v.sale_price),
          manage_stock: !!v.manage_stock,
          stock_quantity: v.stock_quantity ?? null,
          stock_status: v.stock_status || 'instock',
          attributes: attrs,
          vendor_id: vendorId,
          hub_id: resolvedHubId,
          sourcing_meta: buildSourcingMeta(meta),
          is_active: true,
        };

        const { data: upserted, error: varErr } = await adminClient
          .from('product_variations')
          .upsert(varRow, { onConflict: 'woo_variation_id' })
          .select('id')
          .single();

        if (varErr) {
          errors.push(`variation woo_id=${v.id}: ${varErr.message}`);
          continue;
        }

        // Variation image
        if (v.image?.src) {
          await adminClient
            .from('product_images')
            .upsert({
              product_id: product.id,
              variation_id: upserted.id,
              src: v.image.src,
              alt: v.image.alt || '',
              position: 0,
              is_thumbnail: true,
            }, { onConflict: 'product_id,variation_id,position' });
        }
      }

      processed++;
      // Delay between products to avoid overloading IONOS
      await new Promise((r) => setTimeout(r, VAR_INTER_DELAY_MS));
    } catch (e) {
      errors.push(`variations for product woo_id=${product.woo_product_id}: ${e.message}`);
    }
  }

  const totalPages = count ? Math.ceil(count / VAR_PER_PAGE) : 1;

  return {
    success: true,
    phase: 'variations',
    page,
    total_pages: totalPages,
    processed,
    errors,
    has_more: page < totalPages,
  };
}

// ─── handler ──────────────────────────────────────────────────────────────────

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

  const auth = await requireAdmin(event, GLOBAL_SOURCING_ALLOWED_ROLES);
  if (auth.errorResponse) return auth.errorResponse;

  const phase = event.queryStringParameters?.phase || 'taxonomy';
  const page = Math.max(Number(event.queryStringParameters?.page || 1), 1);

  let migrationClient;
  try {
    migrationClient = getMigrationClient();
  } catch (e) {
    return jsonResponse(500, { success: false, error: e.message });
  }

  try {
    if (phase === 'taxonomy') {
      const result = await syncTaxonomy(migrationClient);
      return jsonResponse(200, { success: true, phase: 'taxonomy', ...result });
    }

    if (phase === 'products') {
      const result = await syncProducts(migrationClient, page);
      return jsonResponse(200, result);
    }

    if (phase === 'variations') {
      const result = await syncVariations(migrationClient, page);
      return jsonResponse(200, result);
    }

    return jsonResponse(400, { error: `Unknown phase: ${phase}. Use taxonomy | products | variations` });
  } catch (error) {
    return jsonResponse(error?.statusCode || 500, {
      success: false,
      error: 'Migration failed',
      message: error?.message || String(error),
    });
  }
}
