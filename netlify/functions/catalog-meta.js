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

  const auth = await requireAdmin(event, GLOBAL_SOURCING_ALLOWED_ROLES);
  if (auth.errorResponse) return auth.errorResponse;

  const q = event.queryStringParameters || {};
  const type = q.type;

  // DELETE /catalog-meta?type=tags&id=<uuid>
  if (event.httpMethod === 'DELETE') {
    if (type !== 'tags') return jsonResponse(400, { error: 'DELETE only supported for type=tags' });
    const id = q.id;
    if (!id) return jsonResponse(400, { error: 'id query param required' });
    try {
      const { error } = await auth.adminClient.from('tags').delete().eq('id', id);
      if (error) return jsonResponse(500, { success: false, error: error.message });
      return jsonResponse(200, { success: true });
    } catch (err) {
      return jsonResponse(500, { error: err?.message });
    }
  }

  if (event.httpMethod !== 'GET') return jsonResponse(405, { error: 'Method not allowed' });

  if (!type) return jsonResponse(400, { error: 'type query param required: vendors|hubs|categories|tags|tags_audit' });

  try {
    switch (type) {
      case 'vendors': {
        const { data, error } = await auth.adminClient
          .from('vendors')
          .select('id, store_name, store_slug, woocommerce_vendor_id, hub_id')
          .order('store_name');
        if (error) return jsonResponse(500, { error: error.message });
        return jsonResponse(200, { success: true, data: data || [] });
      }
      case 'hubs': {
        const { data, error } = await auth.adminClient
          .from('hubs')
          .select('id, name, code, city, state, is_sub_hub, parent_hub_id, parent_hub:hubs!parent_hub_id(name)')
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
      case 'tags_audit': {
        // All tags + count of published products using each
        const { data: tags, error: tagErr } = await auth.adminClient
          .from('tags')
          .select('id, name, slug');
        if (tagErr) return jsonResponse(500, { error: tagErr.message });

        const { data: maps, error: mapErr } = await auth.adminClient
          .from('product_tag_map')
          .select('tag_id, product_id, products!inner(status)')
          .eq('products.status', 'published');
        if (mapErr) return jsonResponse(500, { error: mapErr.message });

        const countByTag = {};
        for (const row of (maps || [])) {
          countByTag[row.tag_id] = (countByTag[row.tag_id] || 0) + 1;
        }

        const result = (tags || []).map((t) => ({
          ...t,
          product_count: countByTag[t.id] || 0,
        })).sort((a, b) => b.product_count - a.product_count || a.name.localeCompare(b.name));

        return jsonResponse(200, { success: true, data: result });
      }
      default:
        return jsonResponse(400, { error: 'type must be one of: vendors, hubs, categories, tags, tags_audit' });
    }
  } catch (err) {
    return jsonResponse(500, { error: 'Failed to load meta', message: err?.message });
  }
}
