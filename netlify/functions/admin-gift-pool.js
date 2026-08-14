/**
 * Admin gift pool + product eligibility.
 *
 * GET  /api/admin-gift-pool?gfc_id=<uuid>                    — pool rows for hub
 * GET  /api/admin-gift-pool?gfc_id=<uuid>&search=<q>         — search products to assign
 * POST /api/admin-gift-pool  { action: 'assign' | 'remove' | 'set_eligible', ... }
 * PUT  /api/admin-gift-pool?id=<pool_row_uuid>
 */
import { requireAdmin, adminClient, jsonResponse, headers } from './services/global-sourcing-utils.js';

const POOL_SELECT = `
  id, gift_fulfilment_centre_id, product_id, variation_id,
  available_qty, gift_program_cost, lead_time_days, active,
  created_at, updated_at,
  products ( id, name, slug, sku, regular_price, sale_price, gift_eligible, gift_category, status )
`;

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const auth = await requireAdmin(event, ['admin', 'manager']);
  if (auth.errorResponse) return auth.errorResponse;

  const qs = event.queryStringParameters || {};

  if (event.httpMethod === 'GET') {
    const gfcId = qs.gfc_id;
    const search = (qs.search || '').trim();

    if (!gfcId) {
      return jsonResponse(400, { success: false, error: 'gfc_id required' });
    }

    if (search) {
      const { data: products, error } = await adminClient
        .from('products')
        .select('id, name, slug, sku, regular_price, sale_price, gift_eligible, gift_category, status')
        .or(`name.ilike.%${search.replace(/[%_]/g, '')}%,sku.ilike.%${search.replace(/[%_]/g, '')}%`)
        .in('status', ['publish', 'published'])
        .order('name')
        .limit(25);

      if (error) return jsonResponse(500, { success: false, error: error.message });

      const productIds = (products || []).map((p) => p.id);
      let inPool = new Set();
      if (productIds.length) {
        const { data: poolRows } = await adminClient
          .from('gift_pool_inventory')
          .select('product_id')
          .eq('gift_fulfilment_centre_id', gfcId)
          .in('product_id', productIds);
        inPool = new Set((poolRows || []).map((r) => r.product_id));
      }

      return jsonResponse(200, {
        success: true,
        data: (products || []).map((p) => ({ ...p, in_pool: inPool.has(p.id) })),
      });
    }

    const { data, error } = await adminClient
      .from('gift_pool_inventory')
      .select(POOL_SELECT)
      .eq('gift_fulfilment_centre_id', gfcId)
      .order('created_at', { ascending: false });

    if (error) return jsonResponse(500, { success: false, error: error.message });
    return jsonResponse(200, { success: true, data: data || [] });
  }

  if (event.httpMethod === 'PUT') {
    const id = qs.id;
    if (!id) return jsonResponse(400, { success: false, error: 'id required' });

    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return jsonResponse(400, { success: false, error: 'Invalid JSON' });
    }

    const patch = { updated_at: new Date().toISOString() };
    if (body.available_qty != null) patch.available_qty = Math.max(0, Number(body.available_qty));
    if (body.gift_program_cost !== undefined) {
      patch.gift_program_cost =
        body.gift_program_cost === null || body.gift_program_cost === ''
          ? null
          : Number(body.gift_program_cost);
    }
    if (body.lead_time_days != null) patch.lead_time_days = Math.max(0, Number(body.lead_time_days));
    if (body.active !== undefined) patch.active = Boolean(body.active);

    const { data, error } = await adminClient
      .from('gift_pool_inventory')
      .update(patch)
      .eq('id', id)
      .select(POOL_SELECT)
      .single();

    if (error) return jsonResponse(500, { success: false, error: error.message });
    return jsonResponse(200, { success: true, data });
  }

  if (event.httpMethod === 'POST') {
    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return jsonResponse(400, { success: false, error: 'Invalid JSON' });
    }

    const action = body.action || 'assign';

    if (action === 'remove') {
      const poolId = body.id;
      if (!poolId) return jsonResponse(400, { success: false, error: 'id required' });
      const { error } = await adminClient.from('gift_pool_inventory').delete().eq('id', poolId);
      if (error) return jsonResponse(500, { success: false, error: error.message });
      return jsonResponse(200, { success: true });
    }

    if (action === 'set_eligible') {
      const productId = body.product_id;
      if (!productId) return jsonResponse(400, { success: false, error: 'product_id required' });

      const patch = {};
      if (body.gift_eligible !== undefined) patch.gift_eligible = Boolean(body.gift_eligible);
      if (body.gift_category !== undefined) {
        patch.gift_category = body.gift_category ? String(body.gift_category).trim() : null;
      }
      if (body.gift_box_compatible !== undefined) {
        patch.gift_box_compatible = Boolean(body.gift_box_compatible);
      }
      if (body.gift_recipient_types !== undefined) {
        patch.gift_recipient_types = Array.isArray(body.gift_recipient_types)
          ? body.gift_recipient_types
          : [];
      }
      if (body.gift_occasion_types !== undefined) {
        patch.gift_occasion_types = Array.isArray(body.gift_occasion_types) ? body.gift_occasion_types : [];
      }

      const { data, error } = await adminClient
        .from('products')
        .update(patch)
        .eq('id', productId)
        .select('id, name, gift_eligible, gift_category, gift_box_compatible')
        .single();

      if (error) return jsonResponse(500, { success: false, error: error.message });
      return jsonResponse(200, { success: true, data });
    }

    // assign
    const gfcId = body.gfc_id;
    const productId = body.product_id;
    if (!gfcId || !productId) {
      return jsonResponse(400, { success: false, error: 'gfc_id and product_id required' });
    }

    const row = {
      gift_fulfilment_centre_id: gfcId,
      product_id: productId,
      variation_id: body.variation_id || null,
      available_qty: Math.max(0, Number(body.available_qty ?? 0)),
      gift_program_cost:
        body.gift_program_cost != null && body.gift_program_cost !== ''
          ? Number(body.gift_program_cost)
          : null,
      lead_time_days: Math.max(0, Number(body.lead_time_days ?? 0)),
      active: body.active !== false,
    };

    const { data, error } = await adminClient
      .from('gift_pool_inventory')
      .upsert(row, { onConflict: 'gift_fulfilment_centre_id,product_id,variation_id' })
      .select(POOL_SELECT)
      .single();

    if (error) return jsonResponse(500, { success: false, error: error.message });

    if (body.mark_eligible !== false) {
      await adminClient.from('products').update({ gift_eligible: true }).eq('id', productId);
    }

    return jsonResponse(200, { success: true, data });
  }

  return jsonResponse(405, { success: false, error: 'Method not allowed' });
}
