/**
 * Admin CRUD for ready-made gift boxes (Mode A).
 *
 * GET    /api/admin-gift-boxes?gfc_id=<uuid>
 * GET    /api/admin-gift-boxes?id=<uuid>
 * POST   /api/admin-gift-boxes  { action?: 'add_item'|'remove_item', ... }
 * PUT    /api/admin-gift-boxes?id=<uuid>
 * PATCH  /api/admin-gift-boxes?id=<uuid>  — deactivate
 * DELETE /api/admin-gift-boxes?id=<uuid>  — permanent delete (no gift orders)
 */
import { requireAdmin, adminClient, jsonResponse, headers } from './services/global-sourcing-utils.js';
import { recordStaffAudit } from './services/auditLog.js';
import {
  buildGiftBoxSkuPrefixFromTags,
  computeNextGiftBoxSku,
} from './services/gift-box-sku.js';
import { catalogUnitPrice } from './services/gift-commercial.js';

const BOX_SELECT =
  'id, gift_fulfilment_centre_id, slug, sku, name, description, image_url, gallery_urls, list_price, active, recipient_types, occasion_types, sort_order, created_at, updated_at';

const ITEM_SELECT = `
  id, gift_box_id, product_id, variation_id, quantity, component_cost, sort_order, vendor_payout_status,
  line_source, pool_sourced_item_id,
  products ( id, name, sku, gift_eligible, status, regular_price, sale_price ),
  gift_pool_sourced_items ( id, name, sku, gift_program_cost )
`;

function normalizeGalleryUrls(value) {
  if (!Array.isArray(value)) return [];
  return value.map((u) => String(u || '').trim()).filter(Boolean);
}

function slugify(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function resolveBoxSku(body, slug) {
  if (body.sku?.trim()) return String(body.sku).trim().toUpperCase();
  const prefix = buildGiftBoxSkuPrefixFromTags(
    Array.isArray(body.occasion_types) ? body.occasion_types : [],
    Array.isArray(body.recipient_types) ? body.recipient_types : []
  );
  return computeNextGiftBoxSku(adminClient, prefix, []);
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
    await recordStaffAudit(event, auth.authUser, {
      action: 'GIFT_BOX_DEACTIVATED',
      resource_type: 'gift_boxes',
      resource_id: boxId,
      details: { name: data?.name, sku: data?.sku },
    });
    return jsonResponse(200, { success: true, data });
  }

  if (event.httpMethod === 'DELETE') {
    if (!boxId) return jsonResponse(400, { success: false, error: 'id required' });

    const { count, error: countErr } = await adminClient
      .from('gift_orders')
      .select('id', { count: 'exact', head: true })
      .eq('gift_box_id', boxId);

    if (countErr) return jsonResponse(500, { success: false, error: countErr.message });
    if (count && count > 0) {
      return jsonResponse(409, {
        success: false,
        error: 'Box has gift orders — deactivate instead of deleting',
      });
    }

    const { data: doomed } = await adminClient
      .from('gift_boxes')
      .select('id, name, sku')
      .eq('id', boxId)
      .maybeSingle();
    const { error } = await adminClient.from('gift_boxes').delete().eq('id', boxId);
    if (error) return jsonResponse(500, { success: false, error: error.message });
    await recordStaffAudit(event, auth.authUser, {
      action: 'GIFT_BOX_DELETED',
      resource_type: 'gift_boxes',
      resource_id: boxId,
      details: { name: doomed?.name, sku: doomed?.sku },
    });
    return jsonResponse(200, { success: true });
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
    if (body.gallery_urls !== undefined) patch.gallery_urls = normalizeGalleryUrls(body.gallery_urls);
    if (body.list_price != null) patch.list_price = Math.max(0, Number(body.list_price));
    if (body.active !== undefined) patch.active = Boolean(body.active);
    if (body.sort_order != null) patch.sort_order = Number(body.sort_order);
    if (body.recipient_types !== undefined) {
      patch.recipient_types = Array.isArray(body.recipient_types) ? body.recipient_types : [];
    }
    if (body.occasion_types !== undefined) {
      patch.occasion_types = Array.isArray(body.occasion_types) ? body.occasion_types : [];
    }
    if (body.sku != null) {
      patch.sku = String(body.sku).trim().toUpperCase();
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
    await recordStaffAudit(event, auth.authUser, {
      action: 'GIFT_BOX_UPDATED',
      resource_type: 'gift_boxes',
      resource_id: boxId,
      details: {
        name: data?.name,
        sku: data?.sku,
        occasion_types: data?.occasion_types,
        recipient_types: data?.recipient_types,
        list_price: data?.list_price,
        sku_changed: body.sku != null,
      },
    });
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
      await recordStaffAudit(event, auth.authUser, {
        action: 'GIFT_BOX_ITEM_REMOVED',
        resource_type: 'gift_box_items',
        resource_id: itemId,
        details: { item_id: itemId },
      });
      return jsonResponse(200, { success: true });
    }

    if (action === 'update_item') {
      const itemId = body.item_id;
      if (!itemId) return jsonResponse(400, { success: false, error: 'item_id required' });

      const patch = {};
      if (body.quantity != null) patch.quantity = Math.max(1, Number(body.quantity));
      if (body.component_cost !== undefined) {
        patch.component_cost =
          body.component_cost === null || body.component_cost === ''
            ? null
            : Number(body.component_cost);
      }
      if (body.vendor_payout_status != null) {
        const allowed = ['pending', 'pre_settled', 'paid', 'not_applicable'];
        const status = String(body.vendor_payout_status);
        if (!allowed.includes(status)) {
          return jsonResponse(400, { success: false, error: 'Invalid vendor_payout_status' });
        }
        patch.vendor_payout_status = status;
      }

      if (!Object.keys(patch).length) {
        return jsonResponse(400, { success: false, error: 'Nothing to update' });
      }

      const { data, error } = await adminClient
        .from('gift_box_items')
        .update(patch)
        .eq('id', itemId)
        .select(ITEM_SELECT)
        .single();

      if (error) return jsonResponse(500, { success: false, error: error.message });
      await recordStaffAudit(event, auth.authUser, {
        action: 'GIFT_BOX_ITEM_UPDATED',
        resource_type: 'gift_box_items',
        resource_id: itemId,
        details: { gift_box_id: data?.gift_box_id, patch },
      });
      return jsonResponse(200, { success: true, data });
    }

    if (action === 'add_item') {
      const giftBoxId = body.gift_box_id;
      const productId = body.product_id;
      const sourcedId = body.pool_sourced_item_id;
      if (!giftBoxId || (!productId && !sourcedId)) {
        return jsonResponse(400, { success: false, error: 'gift_box_id and product_id or pool_sourced_item_id required' });
      }

      const { data: parentBox } = await adminClient
        .from('gift_boxes')
        .select('id, gift_fulfilment_centre_id')
        .eq('id', giftBoxId)
        .maybeSingle();
      if (!parentBox) return jsonResponse(404, { success: false, error: 'Box not found' });

      const explicitCost =
        body.component_cost != null && body.component_cost !== ''
          ? Number(body.component_cost)
          : null;

      let row;
      if (sourcedId) {
        const { data: sourced } = await adminClient
          .from('gift_pool_sourced_items')
          .select('id, gift_program_cost, name')
          .eq('id', sourcedId)
          .eq('gift_fulfilment_centre_id', parentBox.gift_fulfilment_centre_id)
          .maybeSingle();
        if (!sourced) return jsonResponse(404, { success: false, error: 'Sourced pool item not found' });
        row = {
          gift_box_id: giftBoxId,
          product_id: null,
          pool_sourced_item_id: sourcedId,
          line_source: 'jlo_sourced',
          variation_id: null,
          quantity: Math.max(1, Number(body.quantity || 1)),
          component_cost: explicitCost != null ? explicitCost : Number(sourced.gift_program_cost || 0),
          sort_order: Number(body.sort_order || 0),
          vendor_payout_status: 'not_applicable',
        };
      } else {
        let componentCost = explicitCost;
        if (componentCost == null) {
          const { data: pool } = await adminClient
            .from('gift_pool_inventory')
            .select('gift_program_cost')
            .eq('gift_fulfilment_centre_id', parentBox.gift_fulfilment_centre_id)
            .eq('product_id', productId)
            .maybeSingle();
          if (pool?.gift_program_cost != null) {
            componentCost = Number(pool.gift_program_cost);
          } else {
            const { data: product } = await adminClient
              .from('products')
              .select('regular_price, sale_price')
              .eq('id', productId)
              .maybeSingle();
            const catalog = catalogUnitPrice(product, null);
            componentCost = catalog > 0 ? catalog : null;
          }
        }
        row = {
          gift_box_id: giftBoxId,
          product_id: productId,
          variation_id: body.variation_id || null,
          pool_sourced_item_id: null,
          line_source: 'vendor_catalog',
          quantity: Math.max(1, Number(body.quantity || 1)),
          component_cost: componentCost,
          sort_order: Number(body.sort_order || 0),
          vendor_payout_status:
            body.vendor_payout_status === 'pre_settled' ? 'pre_settled' : 'pending',
        };
      }

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
      await recordStaffAudit(event, auth.authUser, {
        action: 'GIFT_BOX_ITEM_ADDED',
        resource_type: 'gift_box_items',
        resource_id: data?.id,
        details: { gift_box_id: giftBoxId, product_id: productId },
      });
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

    const occasionTypes = Array.isArray(body.occasion_types) ? body.occasion_types : [];
    const recipientTypes = Array.isArray(body.recipient_types) ? body.recipient_types : [];
    const sku = await resolveBoxSku(
      { ...body, occasion_types: occasionTypes, recipient_types: recipientTypes },
      slug
    );

    const row = {
      gift_fulfilment_centre_id: gfcId,
      name,
      slug,
      sku,
      description: body.description ? String(body.description).trim() : null,
      image_url: body.image_url ? String(body.image_url).trim() : null,
      gallery_urls: normalizeGalleryUrls(body.gallery_urls),
      list_price: listPrice,
      active: body.active !== false,
      recipient_types: recipientTypes,
      occasion_types: occasionTypes,
      sort_order: Number(body.sort_order || 0),
    };

    const { data, error } = await adminClient.from('gift_boxes').insert(row).select(BOX_SELECT).single();

    if (error) {
      if (error.code === '23505') {
        return jsonResponse(409, { success: false, error: 'Slug already in use' });
      }
      return jsonResponse(500, { success: false, error: error.message });
    }
    await recordStaffAudit(event, auth.authUser, {
      action: 'GIFT_BOX_CREATED',
      resource_type: 'gift_boxes',
      resource_id: data?.id,
      details: { name, slug, sku, list_price: listPrice, occasion_types: occasionTypes, recipient_types: recipientTypes },
    });
    return jsonResponse(201, { success: true, data });
  }

  return jsonResponse(405, { success: false, error: 'Method not allowed' });
}
