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
const VAR_PER_PAGE = 3; // 3 variable products per page — each WC call capped at 12s → max ~36s for WC + headroom for Supabase writes

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

async function syncProducts(adminClient, page, wooStatus = 'publish') {
  const errors = [];

  // Pre-fetch lookup maps from Supabase (all parallel)
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

  // Fetch products page from WooCommerce with abort timeout
  const fields = [
    'id', 'name', 'slug', 'description', 'short_description', 'status', 'type',
    'regular_price', 'sale_price', 'sku', 'weight', 'dimensions',
    'manage_stock', 'stock_quantity', 'stock_status',
    'virtual', 'downloadable', 'sold_individually',
    'images', 'categories', 'tags', 'attributes', 'meta_data',
    'date_created',
  ].join(',');

  let wcProducts;
  try {
    const rawBase = process.env.WOO_BASE_URL || process.env.WOOCOMMERCE_URL || '';
    const ck = process.env.WOO_CONSUMER_KEY || process.env.WOOCOMMERCE_CONSUMER_KEY || '';
    const cs = process.env.WOO_CONSUMER_SECRET || process.env.WOOCOMMERCE_CONSUMER_SECRET || '';
    const base = rawBase.includes('/wp-json/') ? rawBase.replace(/\/+$/, '') : `${rawBase.replace(/\/+$/, '')}/wp-json/wc/v3`;

    // For draft products, WC read-only API keys return empty results.
    // Prefer WP Application Password if provided (full admin access, works for all statuses).
    // Uses WP_MEDIA_USERNAME + WORDPRESS_APP_PASSWORD env vars (already set in Netlify).
    const wpUser    = process.env.WP_MEDIA_USERNAME || process.env.WP_ADMIN_USER || '';
    const wpAppPass = process.env.WORDPRESS_APP_PASSWORD || process.env.WP_ADMIN_APP_PASSWORD || '';
    const auth = (wpUser && wpAppPass && wooStatus !== 'publish')
      ? `Basic ${Buffer.from(`${wpUser}:${wpAppPass}`).toString('base64')}`
      : `Basic ${Buffer.from(`${ck}:${cs}`).toString('base64')}`;

    const url = `${base}/products?status=${wooStatus}&per_page=${PER_PAGE}&page=${page}&orderby=id&order=asc&_fields=${fields}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const res = await fetch(url, { signal: controller.signal, headers: { Authorization: auth, 'Content-Type': 'application/json' } });
      const text = await res.text();
      if (!res.ok) {
        // Helpful hint if auth likely failed for drafts
        const hint = (res.status === 401 || res.status === 403) && wooStatus !== 'publish'
          ? ' — Draft products require a Read/Write WC API key or set WP_ADMIN_USER + WP_ADMIN_APP_PASSWORD env vars'
          : '';
        throw new Error(`WC ${res.status}: ${text.slice(0, 120)}${hint}`);
      }
      wcProducts = JSON.parse(text);
    } finally {
      clearTimeout(timer);
    }
  } catch (wcErr) {
    const msg = wcErr.name === 'AbortError' ? 'WC products request timed out (25s)' : wcErr.message?.slice(0, 200);
    return { success: false, error: msg, page, has_more: false };
  }

  if (!Array.isArray(wcProducts)) {
    return { success: false, error: 'WooCommerce returned non-array', page, has_more: false };
  }

  // ── Auto-upsert any variation attribute not yet in product_attributes ────────
  // This ensures attributes like "type", "strap", "option", or any custom WC
  // attribute are persisted — not silently dropped because they weren't seeded
  // in the taxonomy phase (which only seeds colour + size).
  {
    const uniqueAttrs = new Map(); // slug → displayName
    for (const p of wcProducts) {
      for (const a of (p.attributes || [])) {
        if (!a.variation || !a.name) continue;
        const slug = slugify(a.name);
        if (slug && !uniqueAttrs.has(slug)) uniqueAttrs.set(slug, a.name);
      }
    }
    const newAttrDefs = Array.from(uniqueAttrs.entries())
      .filter(([slug]) => !attrMap.has(slug))
      .map(([slug, name]) => ({ name, slug, type: 'select' }));
    if (newAttrDefs.length > 0) {
      const { data: created } = await adminClient
        .from('product_attributes')
        .upsert(newAttrDefs, { onConflict: 'slug', ignoreDuplicates: false })
        .select('id, slug');
      for (const a of (created || [])) attrMap.set(a.slug, a.id);
    }
  }

  // ── Build product rows and secondary data in one pass ───────────────────────
  const productRows = [];
  const secondaryByWooId = new Map(); // woo_product_id → { images, catIds, tagIds, attrRows }

  for (const p of wcProducts) {
    const meta = Array.isArray(p.meta_data) ? p.meta_data : [];

    const wooVendorId = extractMetaValue(meta, ['_wcfm_product_author', '_wcfm_vendor_id', '_vendor_id'])
      || (p.post_author ? String(p.post_author) : null);
    const vendorId = wooVendorId ? (vendorMap.get(String(wooVendorId)) || null) : null;
    const hubId = extractMetaValue(meta, ['_julinemart_hub_id', '_receiving_hub_id', '_hub_id', 'hub_id']);
    const resolvedHubId = hubId && hubSet.has(hubId) ? hubId : null;
    const shipsFromAbroad = parseBool(extractMetaValue(meta, ['_ships_from_abroad', 'ships_from_abroad']));

    productRows.push({
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
      sourcing_meta: (() => {
        const sm = buildSourcingMeta(meta) || {};
        // Always store the raw WC vendor ID so we can backfill vendor_id later
        // once all vendors are imported into Supabase
        if (wooVendorId) sm.wc_vendor_id = String(wooVendorId);
        return Object.keys(sm).length > 0 ? sm : null;
      })(),
      seo_title: extractMetaValue(meta, ['_aioseop_title', '_aioseo_title']) || null,
      seo_description: extractMetaValue(meta, ['_aioseop_description', '_aioseo_description']) || null,
    });

    // Secondary rows built once UUID is known (below)
    const images = (p.images || []).filter(Boolean);
    const catIds = (p.categories || []).map((c) => catMap.get(c.id)).filter(Boolean);
    const tagIds = (p.tags || []).map((t) => tagMap.get(t.id)).filter(Boolean);
    const attrRows = (p.attributes || [])
      .filter((a) => a.variation)
      .map((a) => {
        const attrId = attrMap.get(slugify(a.name));
        if (!attrId) return null;
        return { attribute_id: attrId, options: a.options || [], is_variation: true, display_order: a.position || 0 };
      })
      .filter(Boolean);

    secondaryByWooId.set(p.id, { images, catIds, tagIds, attrRows });
  }

  // ── Deduplicate slugs (DB conflicts + within-batch duplicates) ──────────────
  // Fetch all slugs that already exist in the DB for this batch (including
  // tentative renamed slugs in case a previous import already suffixed them)
  const incomingSlugs = productRows.map(r => r.slug);
  const tentativeSuffixedSlugs = productRows.map(r => `${r.slug}-${r.woo_product_id}`);
  const slugsToCheck = [...new Set([...incomingSlugs, ...tentativeSuffixedSlugs])];

  const { data: existingSlugRows } = await adminClient
    .from('products')
    .select('slug, woo_product_id')
    .in('slug', slugsToCheck);
  const existingSlugMap = new Map((existingSlugRows || []).map(r => [r.slug, r.woo_product_id]));

  // Track slugs used within this batch to catch intra-batch duplicates
  const batchSlugsSeen = new Map(); // slug → woo_product_id first claimant

  const slugDebug = [];
  for (const row of productRows) {
    const originalSlug = row.slug;
    const dbOwner = existingSlugMap.get(row.slug);
    const batchOwner = batchSlugsSeen.get(row.slug);

    const conflictDb    = dbOwner    != null && dbOwner    !== row.woo_product_id;
    const conflictBatch = batchOwner != null && batchOwner !== row.woo_product_id;

    if (conflictDb || conflictBatch) {
      const reason = conflictDb ? `db_owner=${dbOwner}` : `batch_owner=${batchOwner}`;
      row.slug = `${row.slug}-${row.woo_product_id}`;
      slugDebug.push(`woo_id=${row.woo_product_id}: slug "${originalSlug}" → "${row.slug}" (${reason})`);
    }
    batchSlugsSeen.set(row.slug, row.woo_product_id);
  }

  // ── Batch upsert all products in one call ────────────────────────────────────
  const { data: upserted, error: prodErr } = await adminClient
    .from('products')
    .upsert(productRows, { onConflict: 'woo_product_id' })
    .select('id, woo_product_id');

  if (prodErr) {
    return {
      success: false,
      error: prodErr.message,
      page,
      has_more: false,
      debug: {
        batch_slugs: productRows.map(r => ({ woo_id: r.woo_product_id, slug: r.slug })),
        slug_renames: slugDebug,
      },
    };
  }

  const uuidMap = new Map((upserted || []).map((r) => [r.woo_product_id, r.id]));
  const allUuids = (upserted || []).map((r) => r.id);

  // ── Collect secondary rows now that UUIDs are known ──────────────────────────
  const allImages = [], allCatMaps = [], allTagMaps = [], allAttrMaps = [];

  for (const p of wcProducts) {
    const uuid = uuidMap.get(p.id);
    if (!uuid) { errors.push(`product woo_id=${p.id}: missing uuid after upsert`); continue; }
    const { images, catIds, tagIds, attrRows } = secondaryByWooId.get(p.id);

    images.forEach((img, i) =>
      allImages.push({ product_id: uuid, src: img.src, alt: img.alt || '', position: i, is_thumbnail: i === 0 })
    );
    catIds.forEach((cid) => allCatMaps.push({ product_id: uuid, category_id: cid }));
    tagIds.forEach((tid) => allTagMaps.push({ product_id: uuid, tag_id: tid }));
    attrRows.forEach((ar) => allAttrMaps.push({ ...ar, product_id: uuid }));
  }

  // ── Batch delete then batch insert (4 parallel deletes → 4 parallel inserts) ─
  if (allUuids.length > 0) {
    await Promise.all([
      adminClient.from('product_images').delete().in('product_id', allUuids).is('variation_id', null),
      adminClient.from('product_category_map').delete().in('product_id', allUuids),
      adminClient.from('product_tag_map').delete().in('product_id', allUuids),
      adminClient.from('product_attribute_map').delete().in('product_id', allUuids),
    ]);
    await Promise.all([
      allImages.length   > 0 ? adminClient.from('product_images').insert(allImages) : null,
      allCatMaps.length  > 0 ? adminClient.from('product_category_map').insert(allCatMaps) : null,
      allTagMaps.length  > 0 ? adminClient.from('product_tag_map').insert(allTagMaps) : null,
      allAttrMaps.length > 0 ? adminClient.from('product_attribute_map').insert(allAttrMaps) : null,
    ].filter(Boolean));
  }

  return {
    success: true,
    phase: 'products',
    page,
    per_page: PER_PAGE,
    processed: upserted?.length || 0,
    errors,
    has_more: wcProducts.length === PER_PAGE,
  };
}

// ─── phase: variations ────────────────────────────────────────────────────────

async function syncVariations(adminClient, page, statusFilter = null) {
  const errors = [];

  // Load vendor + hub maps
  const [vendorRes, hubRes] = await Promise.all([
    adminClient.from('vendors').select('id, woocommerce_vendor_id'),
    adminClient.from('hubs').select('id'),
  ]);
  const vendorMap = new Map((vendorRes.data || []).map((v) => [String(v.woocommerce_vendor_id), v.id]));
  const hubSet = new Set((hubRes.data || []).map((h) => h.id));

  // Page through variable products in Supabase (optionally filter by status)
  const offset = (page - 1) * VAR_PER_PAGE;
  let varQuery = adminClient
    .from('products')
    .select('id, woo_product_id', { count: 'exact' })
    .eq('type', 'variable')
    .not('woo_product_id', 'is', null)
    .order('woo_product_id', { ascending: true })
    .range(offset, offset + VAR_PER_PAGE - 1);
  if (statusFilter) varQuery = varQuery.eq('status', statusFilter);
  const { data: variableProducts, error: vpErr, count } = await varQuery;

  if (vpErr) return { success: false, error: vpErr.message, page };

  let processed = 0;

  // Local fetch with 12s AbortSignal timeout — requestWoo has no timeout;
  // a single hung IONOS connection would blow the 60s Netlify limit.
  async function fetchWooVariations(wooProductId) {
    const { baseUrl: base, authHeader: auth } = (() => {
      // Re-derive WC config inline to avoid closure issues with ESM
      const rawBase = process.env.WOO_BASE_URL || process.env.WOOCOMMERCE_URL || '';
      const ck = process.env.WOO_CONSUMER_KEY || process.env.WOOCOMMERCE_CONSUMER_KEY || '';
      const cs = process.env.WOO_CONSUMER_SECRET || process.env.WOOCOMMERCE_CONSUMER_SECRET || '';
      const wpUser    = process.env.WP_MEDIA_USERNAME || process.env.WP_ADMIN_USER || '';
      const wpAppPass = process.env.WORDPRESS_APP_PASSWORD || process.env.WP_ADMIN_APP_PASSWORD || '';
      const normalised = rawBase.includes('/wp-json/') ? rawBase.replace(/\/+$/, '') : `${rawBase.replace(/\/+$/, '')}/wp-json/wc/v3`;
      // Prefer WP app password — it has access to draft product variations; WC
      // consumer keys may return empty arrays for drafts with some key scopes.
      const header = (wpUser && wpAppPass)
        ? `Basic ${Buffer.from(`${wpUser}:${wpAppPass}`).toString('base64')}`
        : `Basic ${Buffer.from(`${ck}:${cs}`).toString('base64')}`;
      return { baseUrl: normalised, authHeader: header };
    })();
    const url = `${base}/products/${wooProductId}/variations?per_page=100&_fields=id,sku,regular_price,sale_price,stock_quantity,stock_status,manage_stock,attributes,image,meta_data`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`WC ${res.status}: ${text.slice(0, 120)}`);
      return JSON.parse(text);
    } finally {
      clearTimeout(timer);
    }
  }

  for (const product of (variableProducts || [])) {
    try {
      let wcVars;
      try {
        wcVars = await fetchWooVariations(product.woo_product_id);
      } catch (wcErr) {
        // WooCommerce error (server overloaded, HTML response, or timeout) — skip product
        const msg = wcErr.name === 'AbortError' ? 'WC request timed out (12s)' : wcErr.message?.slice(0, 120);
        errors.push(`woo_id=${product.woo_product_id}: ${msg}`);
        continue;
      }
      if (!Array.isArray(wcVars)) {
        errors.push(`woo_id=${product.woo_product_id}: WC returned non-array`);
        continue;
      }

      // Batch upsert all variations for this product in one call
      const varRows = wcVars.map((v) => {
        const meta = Array.isArray(v.meta_data) ? v.meta_data : [];
        const wooVendorId = extractMetaValue(meta, ['_wcfm_product_author', '_wcfm_vendor_id', '_vendor_id']);
        const hubId = extractMetaValue(meta, ['_julinemart_hub_id', '_receiving_hub_id', '_hub_id', 'hub_id']);
        const attrs = {};
        for (const a of (v.attributes || [])) {
          if (a.name && a.option) attrs[slugify(a.name)] = a.option;
        }
        return {
          product_id: product.id,
          woo_variation_id: v.id,
          sku: v.sku || null,
          regular_price: parsePrice(v.regular_price),
          sale_price: parsePrice(v.sale_price),
          manage_stock: !!v.manage_stock,
          stock_quantity: v.stock_quantity ?? null,
          stock_status: v.stock_status || 'instock',
          attributes: attrs,
          vendor_id: wooVendorId ? (vendorMap.get(String(wooVendorId)) || null) : null,
          hub_id: hubId && hubSet.has(hubId) ? hubId : null,
          sourcing_meta: buildSourcingMeta(meta),
          is_active: true,
          _image: v.image?.src ? { src: v.image.src, alt: v.image.alt || '' } : null,
        };
      });

      const varRowsClean = varRows.map(({ _image, ...r }) => r);
      const { data: upsertedVars, error: varErr } = await adminClient
        .from('product_variations')
        .upsert(varRowsClean, { onConflict: 'woo_variation_id' })
        .select('id, woo_variation_id');

      if (varErr) {
        errors.push(`variations for woo_product=${product.woo_product_id}: ${varErr.message}`);
      } else {
        // Batch insert variation images
        const varUuidMap = new Map((upsertedVars || []).map((r) => [r.woo_variation_id, r.id]));
        const imgRows = varRows
          .filter((r) => r._image)
          .map((r) => ({
            product_id: product.id,
            variation_id: varUuidMap.get(r.woo_variation_id),
            src: r._image.src,
            alt: r._image.alt,
            position: 0,
            is_thumbnail: true,
          }))
          .filter((r) => r.variation_id);

        if (imgRows.length > 0) {
          const variationIdsToReplace = imgRows.map((r) => r.variation_id).filter(Boolean);
          if (variationIdsToReplace.length > 0) {
            await adminClient.from('product_images')
              .delete()
              .in('variation_id', variationIdsToReplace);
          }
          await adminClient.from('product_images').insert(imgRows);
        }

        // ── Rebuild product_attribute_map from actual variation attributes ──────
        // This is authoritative — it runs AFTER we have all variation data, so
        // even if syncProducts missed an attribute (e.g. custom WC attribute), we
        // correct it here with the real option values from the live variations.
        const varAttrCollect = new Map(); // slug → { name, options: Set }
        for (const v of wcVars) {
          for (const a of (v.attributes || [])) {
            if (!a.name || !a.option) continue;
            const slug = slugify(a.name);
            if (!varAttrCollect.has(slug)) varAttrCollect.set(slug, { name: a.name, options: new Set() });
            varAttrCollect.get(slug).options.add(a.option);
          }
        }
        if (varAttrCollect.size > 0) {
          // Ensure every attribute name has a product_attributes row
          const attrDefs = Array.from(varAttrCollect.entries()).map(([slug, { name }]) => ({
            name, slug, type: 'select',
          }));
          const { data: savedAttrs } = await adminClient
            .from('product_attributes')
            .upsert(attrDefs, { onConflict: 'slug', ignoreDuplicates: false })
            .select('id, slug');
          const attrIdBySlug = new Map((savedAttrs || []).map((a) => [a.slug, a.id]));

          const mapRows = Array.from(varAttrCollect.entries())
            .map(([slug, { options }], i) => ({
              product_id: product.id,
              attribute_id: attrIdBySlug.get(slug),
              options: Array.from(options),
              is_variation: true,
              display_order: i,
            }))
            .filter((r) => r.attribute_id);

          if (mapRows.length > 0) {
            await adminClient.from('product_attribute_map').delete().eq('product_id', product.id);
            await adminClient.from('product_attribute_map').insert(mapRows);
          }
        }
      }

      processed++;
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

// ─── phase: fix-attributes (backfill) ────────────────────────────────────────
//
// Fixes all variable products that have variations in Supabase but an empty
// product_attribute_map. Derives the attribute name + full option list directly
// from the variation rows already in the DB — no WooCommerce call needed.
//
// Run once after the initial migration: POST ?phase=fix-attributes
// Supports pagination: ?phase=fix-attributes&page=N  (50 products per page)

const FIX_PER_PAGE = 50;

async function syncFixAttributes(adminClient, page) {
  const errors = [];
  const offset = (page - 1) * FIX_PER_PAGE;

  // Find variable products whose product_attribute_map is empty
  const { data: broken, error: fetchErr, count } = await adminClient
    .from('products')
    .select('id', { count: 'exact' })
    .eq('type', 'variable')
    .not('woo_product_id', 'is', null)
    .order('woo_product_id', { ascending: true })
    .range(offset, offset + FIX_PER_PAGE - 1);

  if (fetchErr) return { success: false, error: fetchErr.message };

  // Filter to those with no attribute_map entries (check in one batch query)
  const ids = (broken || []).map((p) => p.id);
  if (ids.length === 0) return { success: true, phase: 'fix-attributes', page, processed: 0, has_more: false };

  const { data: existingMaps } = await adminClient
    .from('product_attribute_map')
    .select('product_id')
    .in('product_id', ids);
  const hasMaps = new Set((existingMaps || []).map((r) => r.product_id));
  const needsFix = ids.filter((id) => !hasMaps.has(id));

  if (needsFix.length === 0) {
    return {
      success: true, phase: 'fix-attributes', page,
      processed: 0, skipped: ids.length,
      has_more: page < Math.ceil((count || 0) / FIX_PER_PAGE),
    };
  }

  // Load all variations for these products
  const { data: variations, error: varErr } = await adminClient
    .from('product_variations')
    .select('product_id, attributes')
    .in('product_id', needsFix)
    .eq('is_active', true);

  if (varErr) return { success: false, error: varErr.message };

  // Group variation attributes by product_id
  const byProduct = new Map(); // product_id → Map<slug, { name, options: Set }>
  for (const v of (variations || [])) {
    if (!v.attributes) continue;
    if (!byProduct.has(v.product_id)) byProduct.set(v.product_id, new Map());
    const attrCollect = byProduct.get(v.product_id);

    // Handle both storage formats:
    //   CJ:  [{name, value}]  or  [{name, option}]
    //   WC:  {slugified_name: value}
    const entries = Array.isArray(v.attributes)
      ? v.attributes
          .filter((a) => a.name && (a.value ?? a.option) != null)
          .map((a) => [slugify(a.name), { name: String(a.name).trim(), option: String(a.value ?? a.option ?? '').trim() }])
      : typeof v.attributes === 'object'
      ? Object.entries(v.attributes)
          .filter(([k, val]) => k && val != null && String(val).trim() !== '')
          .map(([k, val]) => [k.trim(), { name: k.trim(), option: String(val).trim() }])
      : [];

    for (const [slug, { name, option }] of entries) {
      if (!slug || !option) continue;
      if (!attrCollect.has(slug)) attrCollect.set(slug, { name, options: new Set() });
      attrCollect.get(slug).options.add(option);
    }
  }

  let fixed = 0;
  for (const [productId, attrCollect] of byProduct) {
    if (attrCollect.size === 0) continue;
    try {
      // Upsert attribute definitions
      const attrDefs = Array.from(attrCollect.entries()).map(([slug, { name }]) => ({
        name, slug, type: 'select',
      }));
      const { data: savedAttrs, error: attrUpsertErr } = await adminClient
        .from('product_attributes')
        .upsert(attrDefs, { onConflict: 'slug', ignoreDuplicates: false })
        .select('id, slug');
      if (attrUpsertErr) { errors.push(`product ${productId}: attr upsert: ${attrUpsertErr.message}`); continue; }

      const attrIdBySlug = new Map((savedAttrs || []).map((a) => [a.slug, a.id]));
      const mapRows = Array.from(attrCollect.entries())
        .map(([slug, { options }], i) => ({
          product_id: productId,
          attribute_id: attrIdBySlug.get(slug),
          options: Array.from(options),
          is_variation: true,
          display_order: i,
        }))
        .filter((r) => r.attribute_id);

      if (mapRows.length > 0) {
        await adminClient.from('product_attribute_map').delete().eq('product_id', productId);
        const { error: insertErr } = await adminClient.from('product_attribute_map').insert(mapRows);
        if (insertErr) { errors.push(`product ${productId}: map insert: ${insertErr.message}`); continue; }
        fixed++;
      }
    } catch (e) {
      errors.push(`product ${productId}: ${e.message}`);
    }
  }

  const totalPages = Math.ceil((count || 0) / FIX_PER_PAGE);
  return {
    success: true,
    phase: 'fix-attributes',
    page,
    total_pages: totalPages,
    products_checked: ids.length,
    products_fixed: fixed,
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

  const phase     = event.queryStringParameters?.phase     || 'taxonomy';
  const page      = Math.max(Number(event.queryStringParameters?.page || 1), 1);
  const wooStatus = event.queryStringParameters?.woo_status || 'publish'; // 'publish' | 'draft' | 'any'

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
      const result = await syncProducts(migrationClient, page, wooStatus);
      return jsonResponse(200, result);
    }

    if (phase === 'variations') {
      // woo_status=draft → only process draft variable products (for draft import runner)
      const statusFilter = wooStatus === 'draft' ? 'draft' : null;
      const result = await syncVariations(migrationClient, page, statusFilter);
      return jsonResponse(200, result);
    }

    if (phase === 'fix-attributes') {
      const result = await syncFixAttributes(migrationClient, page);
      return jsonResponse(200, result);
    }

    return jsonResponse(400, { error: `Unknown phase: ${phase}. Use taxonomy | products | variations | fix-attributes` });
  } catch (error) {
    return jsonResponse(error?.statusCode || 500, {
      success: false,
      error: 'Migration failed',
      message: error?.message || String(error),
    });
  }
}
