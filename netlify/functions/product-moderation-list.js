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

  try {
    const page = Math.max(Number(event.queryStringParameters?.page || 1), 1);
    const perPage = Math.min(Math.max(Number(event.queryStringParameters?.per_page || 50), 1), 100);

    const products = await requestWoo(
      `/products?status=draft&per_page=${perPage}&page=${page}&orderby=date&order=desc`
    );
    const list = Array.isArray(products) ? products : [];

    // Filter to only CJ/global-sourcing imported products
    const moderationList = list.filter((p) =>
      extractMetaValue(p.meta_data, ['_global_sourcing_provider', 'global_sourcing_provider'])
    );

    // Collect JLO vendor UUIDs for Supabase lookup
    const jloVendorIds = new Set();
    moderationList.forEach((p) => {
      const vid = extractMetaValue(p.meta_data, ['_jlo_vendor_id', 'vendor_id', '_vendor_id']);
      if (vid && vid.includes('-')) jloVendorIds.add(vid);
    });

    let vendorMap = new Map();
    if (jloVendorIds.size > 0) {
      const { data } = await auth.adminClient
        .from('vendors')
        .select('id, store_name, woocommerce_vendor_id')
        .in('id', Array.from(jloVendorIds));
      if (data) data.forEach((v) => vendorMap.set(v.id, v));
    }

    const normalized = moderationList.map((p) => {
      const jloVendorId = extractMetaValue(p.meta_data, ['_jlo_vendor_id', 'vendor_id', '_vendor_id']);
      const wooVendorId =
        extractMetaValue(p.meta_data, ['_wcfm_vendor_id', '_woocommerce_vendor_id', 'wcfm_vendor_id']) ||
        (p.author ? String(p.author) : null);

      return {
        id: p.id,
        name: p.name,
        status: p.status,
        description: p.description || '',
        short_description: p.short_description || '',
        regular_price: p.regular_price || '',
        sale_price: p.sale_price || '',
        images: (p.images || []).map((img) => ({ id: img.id, src: img.src, alt: img.alt || '' })),
        permalink: p.permalink || null,
        provider: extractMetaValue(p.meta_data, ['_global_sourcing_provider', 'global_sourcing_provider']),
        cj_pid: extractMetaValue(p.meta_data, ['_cj_pid', 'cj_pid', '_supplier_product_id', 'supplier_product_id']),
        jlo_vendor_id: jloVendorId || null,
        woo_vendor_id: wooVendorId,
        vendor: jloVendorId && vendorMap.has(jloVendorId) ? vendorMap.get(jloVendorId) : null,
        date_created: p.date_created || null,
        date_modified: p.date_modified || null,
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
      message: error?.message,
      details: error?.responseBody || null,
    });
  }
}
