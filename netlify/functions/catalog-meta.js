/**
 * GET /api/catalog-meta?type=vendors|hubs|categories|tags
 *
 * Returns dropdown data for the product upload form.
 * Requires admin/shop_manager/agent-with-catalog-access auth.
 */

import {
  headers,
  jsonResponse,
  requireAdmin,
  GLOBAL_SOURCING_ALLOWED_ROLES,
} from './services/global-sourcing-utils.js';

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'GET') return jsonResponse(405, { error: 'Method not allowed' });

  const auth = await requireAdmin(event, GLOBAL_SOURCING_ALLOWED_ROLES);
  if (auth.errorResponse) return auth.errorResponse;

  const type = event.queryStringParameters?.type;
  if (!type) return jsonResponse(400, { error: 'type query param required: vendors|hubs|categories|tags' });

  try {
    switch (type) {
      case 'vendors': {
        const { data, error } = await auth.adminClient
          .from('vendors')
          .select('id, store_name, store_slug, woocommerce_vendor_id')
          .order('store_name');
        if (error) return jsonResponse(500, { error: error.message });
        return jsonResponse(200, { success: true, data: data || [] });
      }
      case 'hubs': {
        const { data, error } = await auth.adminClient
          .from('hubs')
          .select('id, name, code, city, state')
          .order('name');
        if (error) return jsonResponse(500, { error: error.message });
        return jsonResponse(200, { success: true, data: data || [] });
      }
      case 'categories': {
        const { data, error } = await auth.adminClient
          .from('categories')
          .select('id, name, slug, parent_id')
          .order('name');
        if (error) return jsonResponse(500, { error: error.message });
        return jsonResponse(200, { success: true, data: data || [] });
      }
      case 'tags': {
        const { data, error } = await auth.adminClient
          .from('tags')
          .select('id, name, slug')
          .order('name');
        if (error) return jsonResponse(500, { error: error.message });
        return jsonResponse(200, { success: true, data: data || [] });
      }
      default:
        return jsonResponse(400, { error: 'type must be one of: vendors, hubs, categories, tags' });
    }
  } catch (err) {
    return jsonResponse(500, { error: 'Failed to load meta', message: err?.message });
  }
}
