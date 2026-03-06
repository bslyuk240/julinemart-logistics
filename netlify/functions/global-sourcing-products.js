import {
  extractMetaValue,
  headers,
  jsonResponse,
  requestWoo,
  requireAdmin,
} from './services/global-sourcing-utils.js';

async function loadHubMap(client, ids) {
  if (ids.length === 0) return new Map();
  const { data } = await client.from('hubs').select('id, name, code').in('id', ids);
  return new Map((data || []).map((hub) => [hub.id, hub]));
}

async function loadVendorMap(client, ids) {
  if (ids.length === 0) return new Map();
  const { data } = await client
    .from('vendors')
    .select('id, store_name, woocommerce_vendor_id')
    .in('id', ids);
  return new Map((data || []).map((vendor) => [vendor.id, vendor]));
}

function normalizeProduct(product, hubMap, vendorMap) {
  const provider = extractMetaValue(product?.meta_data, [
    '_global_sourcing_provider',
    'global_sourcing_provider',
  ]);
  if (!provider) return null;

  const vendorId = extractMetaValue(product?.meta_data, ['_jlo_vendor_id', 'vendor_id', '_vendor_id']);
  const hubId = extractMetaValue(product?.meta_data, ['_receiving_hub_id', 'receiving_hub_id']);

  return {
    woo_product_id: String(product.id),
    name: product.name,
    status: product.status,
    permalink: product.permalink || null,
    image: product.images?.[0]?.src || null,
    provider,
    external_product_id: extractMetaValue(product?.meta_data, ['_cj_pid', 'cj_pid']),
    external_variant_id: extractMetaValue(product?.meta_data, ['_cj_vid', 'cj_vid']),
    fulfillment_mode: extractMetaValue(product?.meta_data, ['_fulfillment_mode', 'fulfillment_mode']),
    receiving_hub_id: hubId,
    receiving_hub: hubId && hubMap.has(hubId) ? hubMap.get(hubId) : null,
    vendor_id: vendorId,
    vendor: vendorId && vendorMap.has(vendorId) ? vendorMap.get(vendorId) : null,
    global_sourcing_tag: extractMetaValue(product?.meta_data, [
      '_global_sourcing_tag',
      'global_sourcing_tag',
    ]),
    updated_at: product.date_modified_gmt || product.date_modified || null,
  };
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return jsonResponse(405, { success: false, error: 'Method not allowed' });
  }

  const auth = await requireAdmin(event, ['admin']);
  if (auth.errorResponse) return auth.errorResponse;

  try {
    const page = Math.max(Number(event.queryStringParameters?.page || 1), 1);
    const perPage = Math.min(Math.max(Number(event.queryStringParameters?.per_page || 50), 1), 100);
    const products = await requestWoo(`/products?per_page=${perPage}&page=${page}&orderby=date&order=desc`);
    const list = Array.isArray(products) ? products : [];

    const hubIds = new Set();
    const vendorIds = new Set();

    list.forEach((product) => {
      const hubId = extractMetaValue(product?.meta_data, ['_receiving_hub_id', 'receiving_hub_id']);
      const vendorId = extractMetaValue(product?.meta_data, ['_jlo_vendor_id', 'vendor_id', '_vendor_id']);
      if (hubId) hubIds.add(hubId);
      if (vendorId) vendorIds.add(vendorId);
    });

    const [hubMap, vendorMap] = await Promise.all([
      loadHubMap(auth.adminClient, Array.from(hubIds)),
      loadVendorMap(auth.adminClient, Array.from(vendorIds)),
    ]);

    const importedProducts = list
      .map((product) => normalizeProduct(product, hubMap, vendorMap))
      .filter(Boolean);

    return jsonResponse(200, {
      success: true,
      data: importedProducts,
      meta: {
        page,
        per_page: perPage,
        scanned_count: list.length,
        imported_count: importedProducts.length,
      },
    });
  } catch (error) {
    return jsonResponse(error?.statusCode || 500, {
      success: false,
      error: 'Unable to load imported products',
      message: error?.message || 'Woo product query failed',
      details: error?.responseBody || null,
    });
  }
}
