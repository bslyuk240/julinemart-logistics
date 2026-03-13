import {
  GLOBAL_SOURCING_ALLOWED_ROLES,
  headers,
  jsonResponse,
  requireAdmin,
} from './services/global-sourcing-utils.js';

async function loadReferenceData(client) {
  const [{ data: hubs, error: hubError }, { data: vendors, error: vendorError }] =
    await Promise.all([
      client
        .from('hubs')
        .select('id, name, code, is_default, metadata')
        .eq('is_active', true)
        .order('name', { ascending: true }),
      client
        .from('vendors')
        .select('id, store_name, woocommerce_vendor_id')
        .eq('is_active', true)
        .order('store_name', { ascending: true }),
    ]);

  if (hubError) throw hubError;
  if (vendorError) throw vendorError;

  return {
    hubs: hubs || [],
    vendors: vendors || [],
    counts: {
      hubs: hubs?.length || 0,
      vendors: vendors?.length || 0,
    },
  };
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return jsonResponse(405, { success: false, error: 'Method not allowed' });
  }

  const auth = await requireAdmin(event, GLOBAL_SOURCING_ALLOWED_ROLES);
  if (auth.errorResponse) return auth.errorResponse;

  try {
    const data = await loadReferenceData(auth.adminClient);
    return jsonResponse(200, { success: true, data });
  } catch (error) {
    return jsonResponse(500, {
      success: false,
      error: 'Unable to load global sourcing reference data',
      message: error?.message || 'Failed to fetch hubs and vendors',
    });
  }
}
