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
  let categoriesCount = 0;
  let tagsCount = 0;

  // 1. Categories (all pages)
  let catPage = 1;
  while (true) {
    const cats = await requestWoo(`/products/categories?per_page=100&page=${catPage}`);
    if (!Array.isArray(cats) || cats.length === 0) break;

    const rows = cats.map((c) => ({
      woo_term_id: c.id,
      name: c.name || '',
      slug: c.slug || slugify(c.name),
      description: c.description || null,
      image_url: c.image?.src || null,
      display_order: c.menu_order || 0,
      // parent handled in second pass below
    }));

    const { error } = await adminClient
      .from('categories')
      .upsert(rows, { onConflict: 'woo_term_id', ignoreDuplicates: false });
    if (error) errors.push(`categories page ${catPage}: ${error.message}`);
    else categoriesCount += rows.length;

    if (cats.length < 100) break;
    catPage++;
  }

  // 2. Wire up parent_id (second pass — all categories must exist first)
  let parentPage = 1;
  while (true) {
    const cats = await requestWoo(`/products/categories?per_page=100&page=${parentPage}&parent=0&exclude=0`);
    // Get all cats with a parent
    const withParent = await requestWoo(`/products/categories?per_page=100&page=${parentPage}`);
    if (!Array.isArray(withParent) || withParent.length === 0) break;

    for (const c of withParent) {
      if (!c.parent || c.parent === 0) continue;
      // Find parent uuid in Supabase
      const { data: parentRow } = await adminClient
        .from('categories')
        .select('id')
        .eq('woo_term_id', c.parent)
        .maybeSingle();
      if (!parentRow) continue;

      const { data: childRow } = await adminClient
        .from('categories')
        .select('id')
        .eq('woo_term_id', c.id)
        .maybeSingle();
      if (!childRow) continue;

      await adminClient
        .from('categories')
        .update({ parent_id: parentRow.id })
        .eq('id', childRow.id);
    }
    if (withParent.length < 100) break;
    parentPage++;
  }

  // 3. Tags (all pages)
  let tagPage = 1;
  while (true) {
    const tags = await requestWoo(`/products/tags?per_page=100&page=${tagPage}`);
    if (!Array.isArray(tags) || tags.length === 0) break;

    const rows = tags.map((t) => ({
      woo_term_id: t.id,
      name: t.name || '',
      slug: t.slug || slugify(t.name),
    }));

    const { error } = await adminClient
      .from('tags')
      .upsert(rows, { onConflict: 'woo_term_id', ignoreDuplicates: false });
    if (error) errors.push(`tags page ${tagPage}: ${error.message}`);
    else tagsCount += rows.length;

    if (tags.length < 100) break;
    tagPage++;
  }

  // 4. Seed the 2 global attributes
  const attrRows = [
    { name: 'Colour', slug: 'colour', type: 'select', display_order: 1 },
    { name: 'Size',   slug: 'size',   type: 'select', display_order: 2 },
  ];
  const { error: attrErr } = await adminClient
    .from('product_attributes')
    .upsert(attrRows, { onConflict: 'slug', ignoreDuplicates: false });
  if (attrErr) errors.push(`attributes: ${attrErr.message}`);

  return {
    success: errors.length === 0,
    categories: categoriesCount,
    tags: tagsCount,
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
  const offset = (page - 1) * PER_PAGE;
  const { data: variableProducts, error: vpErr, count } = await adminClient
    .from('products')
    .select('id, woo_product_id', { count: 'exact' })
    .eq('type', 'variable')
    .not('woo_product_id', 'is', null)
    .order('woo_product_id', { ascending: true })
    .range(offset, offset + PER_PAGE - 1);

  if (vpErr) return { success: false, error: vpErr.message, page };

  let processed = 0;

  for (const product of (variableProducts || [])) {
    try {
      const wcVars = await requestWoo(
        `/products/${product.woo_product_id}/variations?per_page=100&_fields=id,sku,regular_price,sale_price,stock_quantity,stock_status,manage_stock,attributes,image,meta_data`
      );
      if (!Array.isArray(wcVars)) continue;

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
    } catch (e) {
      errors.push(`variations for product woo_id=${product.woo_product_id}: ${e.message}`);
    }
  }

  const totalPages = count ? Math.ceil(count / PER_PAGE) : 1;

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

  try {
    if (phase === 'taxonomy') {
      const result = await syncTaxonomy(auth.adminClient);
      return jsonResponse(200, { success: true, phase: 'taxonomy', ...result });
    }

    if (phase === 'products') {
      const result = await syncProducts(auth.adminClient, page);
      return jsonResponse(200, result);
    }

    if (phase === 'variations') {
      const result = await syncVariations(auth.adminClient, page);
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
