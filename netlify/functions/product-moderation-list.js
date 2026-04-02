import {
  extractMetaValue,
  GLOBAL_SOURCING_ALLOWED_ROLES,
  headers,
  jsonResponse,
  requestWoo,
  requireAdmin,
} from './services/global-sourcing-utils.js';

const isUuid = (v) => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v);

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'GET') return jsonResponse(405, { error: 'Method not allowed' });

  const auth = await requireAdmin(event, GLOBAL_SOURCING_ALLOWED_ROLES);
  if (auth.errorResponse) return auth.errorResponse;

  try {
    const page = Math.max(Number(event.queryStringParameters?.page || 1), 1);
    // Hard-cap at 10 per page — WooCommerce on shared hosting is resource-intensive.
    // Fetching too many products at once spikes server CPU/memory and takes the
    // storefront offline. 10 is safe without overloading the server.
    const perPage = Math.min(Math.max(Number(event.queryStringParameters?.per_page || 10), 1), 10);

    // Request only the fields we actually need for the list view.
    // This dramatically reduces the PHP processing and response payload on WC.
    const fields = [
      'id', 'name', 'status', 'regular_price', 'images', 'author',
      'meta_data', 'date_created',
    ].join(',');

    const products = await requestWoo(
      `/products?status=draft&per_page=${perPage}&page=${page}&orderby=date&order=desc&_fields=${fields}`
    );
    const list = Array.isArray(products) ? products : [];

    // Filter to only CJ/global-sourcing imported products
    const moderationList = list.filter((p) => {
      const meta = Array.isArray(p.meta_data) ? p.meta_data : [];
      return extractMetaValue(meta, ['_global_sourcing_provider', 'global_sourcing_provider']);
    });

    // Collect valid UUIDs for Supabase batch lookup
    const jloVendorIds = new Set();
    const hubIds = new Set();

    moderationList.forEach((p) => {
      const meta = Array.isArray(p.meta_data) ? p.meta_data : [];
      const vid = extractMetaValue(meta, ['_jlo_vendor_id', '_vendor_id']);
      const hid = extractMetaValue(meta, ['_receiving_hub_id', 'receiving_hub_id', '_julinemart_hub_id', '_hub_id', 'hub_id']);
      if (isUuid(vid)) jloVendorIds.add(vid);
      if (isUuid(hid)) hubIds.add(hid);
    });

    // Batch resolve vendor + hub names from Supabase (non-fatal)
    let vendorMap = new Map();
    let hubMap = new Map();
    try {
      const [vendorRes, hubRes] = await Promise.all([
        jloVendorIds.size > 0
          ? auth.adminClient.from('vendors').select('id, store_name, woocommerce_vendor_id').in('id', Array.from(jloVendorIds))
          : Promise.resolve({ data: [] }),
        hubIds.size > 0
          ? auth.adminClient.from('hubs').select('id, name, code').in('id', Array.from(hubIds))
          : Promise.resolve({ data: [] }),
      ]);
      if (vendorRes.data) vendorRes.data.forEach((v) => vendorMap.set(v.id, v));
      if (hubRes.data) hubRes.data.forEach((h) => hubMap.set(h.id, h));
    } catch (_e) {
      // Non-fatal — list still returns without enriched names
    }

    const normalized = moderationList.map((p) => {
      const meta = Array.isArray(p.meta_data) ? p.meta_data : [];
      const jloVendorId = extractMetaValue(meta, ['_jlo_vendor_id', '_vendor_id']) || null;
      const hubId = extractMetaValue(meta, ['_receiving_hub_id', 'receiving_hub_id', '_julinemart_hub_id', '_hub_id', 'hub_id']) || null;
      const wooVendorId =
        extractMetaValue(meta, ['_wcfm_vendor_id', '_woocommerce_vendor_id', 'wcfm_vendor_id']) ||
        (p.author ? String(p.author) : null);

      return {
        id: p.id,
        name: p.name || '',
        status: p.status || 'draft',
        regular_price: p.regular_price || '',
        images: (p.images || []).filter(Boolean).map((img) => ({ id: img.id, src: img.src, alt: img.alt || '' })),
        provider: extractMetaValue(meta, ['_global_sourcing_provider', 'global_sourcing_provider']),
        cj_pid: extractMetaValue(meta, ['_cj_pid', 'cj_pid', '_supplier_product_id', 'supplier_product_id']),
        jlo_vendor_id: jloVendorId,
        woo_vendor_id: wooVendorId,
        vendor: isUuid(jloVendorId) && vendorMap.has(jloVendorId) ? vendorMap.get(jloVendorId) : null,
        hub_id: hubId,
        hub: isUuid(hubId) && hubMap.has(hubId) ? hubMap.get(hubId) : null,
        date_created: p.date_created || null,
      };
    });

    return jsonResponse(200, {
      success: true,
      data: normalized,
      meta: { page, per_page: perPage, scanned: list.length, count: normalized.length },
    });
  } catch (error) {
    return jsonResponse(error?.statusCode || 500, {
      success: false,
      error: 'Failed to load moderation list',
      message: error?.message || String(error),
      details: error?.responseBody || null,
    });
  }
}
