/**
 * GET  /api/catalog-meta?type=vendors|hubs|categories|categories_audit|tags|tags_audit
 * POST /api/catalog-meta?type=tags|categories — create
 * PUT  /api/catalog-meta?type=categories&id=<uuid> — update
 * DELETE /api/catalog-meta?type=tags|categories&id=<uuid> — delete
 *
 * Returns dropdown data for the product upload form, and backs the
 * Tags/Categories admin pages (create/edit/delete). Categories are
 * Supabase-native — woo_term_id is left null for admin-created rows and is
 * never required; nothing here talks to WooCommerce.
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

  // DELETE /catalog-meta?type=tags|categories&id=<uuid>
  if (event.httpMethod === 'DELETE') {
    if (type !== 'tags' && type !== 'categories') {
      return jsonResponse(400, { error: 'DELETE only supported for type=tags or type=categories' });
    }
    const id = q.id;
    if (!id) return jsonResponse(400, { error: 'id query param required' });

    if (type === 'categories') {
      const { count: childCount } = await auth.adminClient
        .from('categories')
        .select('id', { count: 'exact', head: true })
        .eq('parent_id', id);
      if (childCount && childCount > 0) {
        return jsonResponse(409, {
          error: `This category has ${childCount} subcategor${childCount === 1 ? 'y' : 'ies'} under it. Reassign or delete those first.`,
        });
      }
      try {
        await auth.adminClient.from('product_category_map').delete().eq('category_id', id);
        const { error } = await auth.adminClient.from('categories').delete().eq('id', id);
        if (error) return jsonResponse(500, { success: false, error: error.message });
        return jsonResponse(200, { success: true });
      } catch (err) {
        return jsonResponse(500, { error: err?.message });
      }
    }

    try {
      const { error } = await auth.adminClient.from('tags').delete().eq('id', id);
      if (error) return jsonResponse(500, { success: false, error: error.message });
      return jsonResponse(200, { success: true });
    } catch (err) {
      return jsonResponse(500, { error: err?.message });
    }
  }

  // POST /catalog-meta?type=tags|categories — create
  // PUT  /catalog-meta?type=categories&id=<uuid> — update
  if (event.httpMethod === 'POST' || event.httpMethod === 'PUT') {
    const isPut = event.httpMethod === 'PUT';
    if (type !== 'tags' && type !== 'categories') {
      return jsonResponse(400, { error: `${event.httpMethod} only supported for type=tags or type=categories` });
    }
    if (isPut && type !== 'categories') {
      return jsonResponse(400, { error: 'PUT only supported for type=categories' });
    }
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return jsonResponse(400, { error: 'Invalid JSON' }); }

    if (type === 'tags') {
      const name = String(body.name || '').trim();
      const slug = String(body.slug || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      if (!name || !slug) return jsonResponse(400, { error: 'name and slug are required' });
      try {
        const { data, error } = await auth.adminClient
          .from('tags').insert({ name, slug }).select('id, name, slug').single();
        if (error) {
          if (error.code === '23505') return jsonResponse(409, { error: `Tag slug "${slug}" already exists` });
          return jsonResponse(500, { error: error.message });
        }
        return jsonResponse(201, { success: true, data });
      } catch (err) {
        return jsonResponse(500, { error: err?.message });
      }
    }

    // type === 'categories'
    const id = q.id;
    if (isPut && !id) return jsonResponse(400, { error: 'id query param required' });

    const name = String(body.name || '').trim();
    const slug = String(body.slug || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    if (!isPut && (!name || !slug)) return jsonResponse(400, { error: 'name and slug are required' });

    const parentId = 'parent_id' in body ? (body.parent_id || null) : undefined;
    if (parentId && parentId === id) {
      return jsonResponse(400, { error: 'A category cannot be its own parent' });
    }

    const categoryData = {
      ...(body.name !== undefined && { name }),
      ...(body.slug !== undefined && { slug }),
      ...(parentId !== undefined && { parent_id: parentId }),
      ...(body.description !== undefined && { description: body.description || null }),
      ...(body.image_url !== undefined && { image_url: body.image_url || null }),
      updated_at: new Date().toISOString(),
    };

    try {
      if (isPut) {
        const { data, error } = await auth.adminClient
          .from('categories')
          .update(categoryData)
          .eq('id', id)
          .select('id, name, slug, parent_id, description, image_url')
          .single();
        if (error) {
          if (error.code === '23505') return jsonResponse(409, { error: `Category slug "${slug}" already exists` });
          return jsonResponse(500, { error: error.message });
        }
        if (!data) return jsonResponse(404, { error: 'Category not found' });
        return jsonResponse(200, { success: true, data });
      }

      const { data, error } = await auth.adminClient
        .from('categories')
        .insert(categoryData)
        .select('id, name, slug, parent_id, description, image_url')
        .single();
      if (error) {
        if (error.code === '23505') return jsonResponse(409, { error: `Category slug "${slug}" already exists` });
        return jsonResponse(500, { error: error.message });
      }
      return jsonResponse(201, { success: true, data });
    } catch (err) {
      return jsonResponse(500, { error: err?.message });
    }
  }

  if (event.httpMethod !== 'GET') return jsonResponse(405, { error: 'Method not allowed' });

  if (!type) return jsonResponse(400, { error: 'type query param required: vendors|hubs|categories|categories_audit|tags|tags_audit' });

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
      case 'categories_audit': {
        const { data: categories, error: catErr } = await auth.adminClient
          .from('categories')
          .select('id, name, slug, parent_id, description, image_url');
        if (catErr) return jsonResponse(500, { error: catErr.message });

        const { data: maps, error: mapErr } = await auth.adminClient
          .from('product_category_map')
          .select('category_id, product_id, products!inner(status)')
          .eq('products.status', 'published');
        if (mapErr) return jsonResponse(500, { error: mapErr.message });

        const countByCategory = {};
        for (const row of (maps || [])) {
          countByCategory[row.category_id] = (countByCategory[row.category_id] || 0) + 1;
        }

        const result = (categories || [])
          .map((c) => ({ ...c, product_count: countByCategory[c.id] || 0 }))
          .sort((a, b) => a.name.localeCompare(b.name));

        return jsonResponse(200, { success: true, data: result });
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
        return jsonResponse(400, { error: 'type must be one of: vendors, hubs, categories, categories_audit, tags, tags_audit' });
    }
  } catch (err) {
    return jsonResponse(500, { error: 'Failed to load meta', message: err?.message });
  }
}
