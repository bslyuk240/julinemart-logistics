/**
 * Admin CRUD for ready-made gift boxes (Mode A).
 *
 * GET    /api/admin-gift-boxes?gfc_id=<uuid>
 * GET    /api/admin-gift-boxes?id=<uuid>
 * POST   /api/admin-gift-boxes  { action?: 'add_item'|'remove_item', ... }
 * PUT    /api/admin-gift-boxes?id=<uuid>
 * PATCH  /api/admin-gift-boxes?id=<uuid>  — deactivate
 */
import { requireAdmin, adminClient, jsonResponse, headers } from './services/global-sourcing-utils.js';

const BOX_SELECT =
  'id, gift_fulfilment_centre_id, slug, name, description, image_url, list_price, active, recipient_types, occasion_types, sort_order, created_at, updated_at';

const ITEM_SELECT = `
  id, gift_box_id, product_id, variation_id, quantity, component_cost, sort_order,
  products ( id, name, sku, gift_eligible, status )
`;

function slugify(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function loadBoxWithItems(boxId) {
  const { data: box, error } = await adminClient
    .from('gift_boxes')
    .select(BOX_SELECT)
    .eq('id', boxId)
    .single();
  if (error) return { error };

  const { data: items, error: itemsErr } = await adminClient
    .from('gift_box_items')
    .select(ITEM_SELECT)
    .eq('gift_box_id', boxId)
    .order('sort_order', { ascending: true });

  if (itemsErr) return { error: itemsErr };
  return { data: { ...box, items: items || [] } };
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const auth = await requireAdmin(event, ['admin', 'manager']);
  if (auth.errorResponse) return auth.errorResponse;

  const qs = event.queryStringParameters || {};
  const boxId = qs.id;

  if (event.httpMethod === 'GET') {
    if (boxId) {
      const result = await loadBoxWithItems(boxId);
      if (result.error) return jsonResponse(500, { success: false, error: result.error.message });
      return jsonResponse(200, { success: true, data: result.data });
    }

    let query = adminClient.from('gift_boxes').select(BOX_SELECT).order('sort_order').order('name');
    if (qs.gfc_id) query = query.eq('gift_fulfilment_centre_id', qs.gfc_id);

    const { data, error } = await query;
    if (error) return jsonResponse(500, { success: false, error: error.message });
    return jsonResponse(200, { success: true, data: data || [] });
  }

  if (event.httpMethod === 'PATCH') {
    if (!boxId) return jsonResponse(400, { success: false, error: 'id required' });
    const { data, error } = await adminClient
      .from('gift_boxes')
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq('id', boxId)
      .select(BOX_SELECT)
      .single();
    if (error) return jsonResponse(500, { success: false, error: error.message });
    return jsonResponse(200, { success: true, data });
  }

  if (event.httpMethod === 'PUT') {
    if (!boxId) return jsonResponse(400, { success: false, error: 'id required' });

    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return jsonResponse(400, { success: false, error: 'Invalid JSON' });
    }

    const patch = { updated_at: new Date().toISOString() };
    if (body.name != null) patch.name = String(body.name).trim();
    if (body.slug != null) patch.slug = slugify(body.slug);
    if (body.description !== undefined) patch.description = body.description ? String(body.description).trim() : null;
    if (body.image_url !== undefined) patch.image_url = body.image_url ? String(body.image_url).trim() : null;
    if (body.list_price != null) patch.list_price = Math.max(0, Number(body.list_price));
    if (body.active !== undefined) patch.active = Boolean(body.active);
    if (body.sort_order != null) patch.sort_order = Number(body.sort_order);
    if (body.recipient_types !== undefined) {
      patch.recipient_types = Array.isArray(body.recipient_types) ? body.recipient_types : [];
    }
    if (body.occasion_types !== undefined) {
      patch.occasion_types = Array.isArray(body.occasion_types) ? body.occasion_types : [];
    }

    const { data, error } = await adminClient
      .from('gift_boxes')
      .update(patch)
      .eq('id', boxId)
      .select(BOX_SELECT)
      .single();

    if (error) {
      if (error.code === '23505') {
        return jsonResponse(409, { success: false, error: 'Slug already in use' });
      }
      return jsonResponse(500, { success: false, error: error.message });
    }
    return jsonResponse(200, { success: true, data });
  }

  if (event.httpMethod === 'POST') {
    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return jsonResponse(400, { success: false, error: 'Invalid JSON' });
    }

    const action = body.action;

    if (action === 'remove_item') {
      const itemId = body.item_id;
      if (!itemId) return jsonResponse(400, { success: false, error: 'item_id required' });
      const { error } = await adminClient.from('gift_box_items').delete().eq('id', itemId);
      if (error) return jsonResponse(500, { success: false, error: error.message });
      return jsonResponse(200, { success: true });
    }

    if (action === 'add_item') {
      const giftBoxId = body.gift_box_id;
      const productId = body.product_id;
      if (!giftBoxId || !productId) {
        return jsonResponse(400, { success: false, error: 'gift_box_id and product_id required' });
      }

      const row = {
        gift_box_id: giftBoxId,
        product_id: productId,
        variation_id: body.variation_id || null,
        quantity: Math.max(1, Number(body.quantity || 1)),
        component_cost:
          body.component_cost != null && body.component_cost !== ''
            ? Number(body.component_cost)
            : null,
        sort_order: Number(body.sort_order || 0),
      };

      const { data, error } = await adminClient
        .from('gift_box_items')
        .insert(row)
        .select(ITEM_SELECT)
        .single();

      if (error) {
        if (error.code === '23505') {
          return jsonResponse(409, { success: false, error: 'Product already in this box' });
        }
        return jsonResponse(500, { success: false, error: error.message });
      }
      return jsonResponse(201, { success: true, data });
    }

    const gfcId = body.gift_fulfilment_centre_id;
    const name = String(body.name || '').trim();
    const slug = slugify(body.slug || name);
    const listPrice = Number(body.list_price);

    if (!gfcId || !name || !slug || !Number.isFinite(listPrice) || listPrice < 0) {
      return jsonResponse(400, {
        success: false,
        error: 'gift_fulfilment_centre_id, name, slug, and list_price are required',
      });
    }

    const row = {
      gift_fulfilment_centre_id: gfcId,
      name,
      slug,
      description: body.description ? String(body.description).trim() : null,
      image_url: body.image_url ? String(body.image_url).trim() : null,
      list_price: listPrice,
      active: body.active !== false,
      recipient_types: Array.isArray(body.recipient_types) ? body.recipient_types : [],
      occasion_types: Array.isArray(body.occasion_types) ? body.occasion_types : [],
      sort_order: Number(body.sort_order || 0),
    };

    const { data, error } = await adminClient.from('gift_boxes').insert(row).select(BOX_SELECT).single();

    if (error) {
      if (error.code === '23505') {
        return jsonResponse(409, { success: false, error: 'Slug already in use' });
      }
      return jsonResponse(500, { success: false, error: error.message });
    }
    return jsonResponse(201, { success: true, data });
  }

  return jsonResponse(405, { success: false, error: 'Method not allowed' });
}
