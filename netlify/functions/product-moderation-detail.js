import {
  extractMetaValue,
  GLOBAL_SOURCING_ALLOWED_ROLES,
  headers,
  jsonResponse,
  requestWoo,
  requireAdmin,
} from './services/global-sourcing-utils.js';

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'GET') return jsonResponse(405, { error: 'Method not allowed' });

  const auth = await requireAdmin(event, GLOBAL_SOURCING_ALLOWED_ROLES);
  if (auth.errorResponse) return auth.errorResponse;

  const id = String(event.queryStringParameters?.id || '').trim();
  if (!id) return jsonResponse(400, { success: false, error: 'id is required' });

  try {
    // ── Fetch product + variations from WooCommerce ──────────────────────
    const [product, variationsRaw] = await Promise.all([
      requestWoo(`/products/${encodeURIComponent(id)}`),
      requestWoo(`/products/${encodeURIComponent(id)}/variations?per_page=100`).catch(() => []),
    ]);

    const metaData = Array.isArray(product.meta_data) ? product.meta_data : [];

    // ── Extract IDs from meta ────────────────────────────────────────────
    const jloVendorId = extractMetaValue(metaData, ['_jlo_vendor_id', '_vendor_id']) || null;
    const hubId = extractMetaValue(metaData, [
      '_receiving_hub_id', 'receiving_hub_id', '_julinemart_hub_id', '_hub_id', 'hub_id',
    ]) || null;

    // ── Resolve vendor + hub from Supabase (non-fatal) ───────────────────
    const isUuid = (v) => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v);

    let vendor = null;
    let hub = null;

    try {
      const [vendorRes, hubRes] = await Promise.all([
        isUuid(jloVendorId)
          ? auth.adminClient.from('vendors').select('id, store_name, woocommerce_vendor_id').eq('id', jloVendorId).maybeSingle()
          : Promise.resolve({ data: null }),
        isUuid(hubId)
          ? auth.adminClient.from('hubs').select('id, name, code').eq('id', hubId).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      vendor = vendorRes?.data || null;
      hub = hubRes?.data || null;
    } catch (_e) {
      // Non-fatal — continue without enriched vendor/hub names
    }

    // ── Normalise variations ─────────────────────────────────────────────
    const variations = Array.isArray(variationsRaw)
      ? variationsRaw.map((v) => ({
          id: v.id,
          status: v.status || 'publish',
          sku: v.sku || '',
          regular_price: v.regular_price || '',
          sale_price: v.sale_price || '',
          stock_status: v.stock_status || 'instock',
          manage_stock: v.manage_stock || false,
          stock_quantity: v.stock_quantity ?? null,
          image: v.image ? { id: v.image.id, src: v.image.src, alt: v.image.alt || '' } : null,
          attributes: (v.attributes || []).map((a) => ({ name: a.name, option: a.option })),
        }))
      : [];

    return jsonResponse(200, {
      success: true,
      data: {
        id: product.id,
        name: product.name || '',
        type: product.type || 'simple',
        status: product.status || 'draft',
        description: product.description || '',
        short_description: product.short_description || '',
        sku: product.sku || '',
        regular_price: product.regular_price || '',
        sale_price: product.sale_price || '',
        stock_status: product.stock_status || 'instock',
        manage_stock: product.manage_stock || false,
        stock_quantity: product.stock_quantity ?? null,
        weight: product.weight || '',
        dimensions: {
          length: product.dimensions?.length || '',
          width: product.dimensions?.width || '',
          height: product.dimensions?.height || '',
        },
        shipping_class: product.shipping_class || '',
        shipping_class_id: product.shipping_class_id ?? null,
        catalog_visibility: product.catalog_visibility || 'visible',
        purchase_note: product.purchase_note || '',
        images: (product.images || []).filter(Boolean).map((img) => ({
          id: img.id,
          src: img.src,
          alt: img.alt || '',
        })),
        categories: (product.categories || []).map((c) => ({ id: c.id, name: c.name, slug: c.slug })),
        tags: (product.tags || []).map((t) => ({ id: t.id, name: t.name, slug: t.slug })),
        attributes: (product.attributes || []).map((a) => ({
          id: a.id,
          name: a.name,
          visible: a.visible,
          variation: a.variation,
          options: a.options || [],
        })),
        variations,
        permalink: product.permalink || null,
        provider: extractMetaValue(metaData, ['_global_sourcing_provider', 'global_sourcing_provider']),
        cj_pid: extractMetaValue(metaData, ['_cj_pid', 'cj_pid', '_supplier_product_id']),
        jlo_vendor_id: jloVendorId,
        woo_vendor_id:
          extractMetaValue(metaData, ['_wcfm_vendor_id', '_woocommerce_vendor_id', 'wcfm_vendor_id']) ||
          (product.author ? String(product.author) : null),
        vendor,
        hub_id: hubId,
        hub,
        meta_pricing: {
          supplier_price_usd: extractMetaValue(metaData, ['_supplier_price_snapshot_usd']),
          landed_cost_usd: extractMetaValue(metaData, ['_landed_cost_snapshot_usd']),
          exchange_rate: extractMetaValue(metaData, ['_usd_to_ngn_rate_snapshot']),
          inbound_shipping_usd: extractMetaValue(metaData, ['_inbound_shipping_snapshot_usd']),
        },
      },
    });
  } catch (error) {
    return jsonResponse(error?.statusCode || 500, {
      success: false,
      error: 'Failed to load product detail',
      message: error?.message || String(error),
      details: error?.responseBody || null,
    });
  }
}
