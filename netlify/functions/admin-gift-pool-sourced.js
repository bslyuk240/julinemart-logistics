/**
 * Admin CRUD for JLO-sourced gift pool items (no catalog product required).
 *
 * GET    /api/admin-gift-pool-sourced?gfc_id=<uuid>
 * POST   /api/admin-gift-pool-sourced
 * PUT    /api/admin-gift-pool-sourced?id=<uuid>
 * DELETE /api/admin-gift-pool-sourced?id=<uuid>
 */
import { requireAdmin, adminClient, jsonResponse, headers } from './services/global-sourcing-utils.js';

const SELECT =
  'id, gift_fulfilment_centre_id, name, sku, description, image_url, gift_category, gift_program_cost, contribution_weight, available_qty, lead_time_days, active, created_at, updated_at';

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const auth = await requireAdmin(event, ['admin', 'manager']);
  if (auth.errorResponse) return auth.errorResponse;

  const qs = event.queryStringParameters || {};
  const id = qs.id;

  if (event.httpMethod === 'GET') {
    const gfcId = qs.gfc_id;
    if (!gfcId) return jsonResponse(400, { success: false, error: 'gfc_id required' });

    const { data, error } = await adminClient
      .from('gift_pool_sourced_items')
      .select(SELECT)
      .eq('gift_fulfilment_centre_id', gfcId)
      .order('name');

    if (error) return jsonResponse(500, { success: false, error: error.message });
    return jsonResponse(200, { success: true, data: data || [] });
  }

  if (event.httpMethod === 'DELETE') {
    if (!id) return jsonResponse(400, { success: false, error: 'id required' });
    const { error } = await adminClient.from('gift_pool_sourced_items').delete().eq('id', id);
    if (error) return jsonResponse(500, { success: false, error: error.message });
    return jsonResponse(200, { success: true });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return jsonResponse(400, { success: false, error: 'Invalid JSON' });
  }

  if (event.httpMethod === 'PUT') {
    if (!id) return jsonResponse(400, { success: false, error: 'id required' });

    const patch = { updated_at: new Date().toISOString() };
    if (body.name != null) patch.name = String(body.name).trim();
    if (body.sku !== undefined) patch.sku = body.sku ? String(body.sku).trim() : null;
    if (body.description !== undefined) patch.description = body.description ? String(body.description).trim() : null;
    if (body.image_url !== undefined) patch.image_url = body.image_url ? String(body.image_url).trim() : null;
    if (body.gift_category !== undefined) patch.gift_category = body.gift_category ? String(body.gift_category).trim() : null;
    if (body.gift_program_cost != null) patch.gift_program_cost = Math.max(0, Number(body.gift_program_cost));
    if (body.contribution_weight != null) patch.contribution_weight = Math.max(0, Number(body.contribution_weight));
    if (body.available_qty != null) patch.available_qty = Math.max(0, Number(body.available_qty));
    if (body.lead_time_days != null) patch.lead_time_days = Math.max(0, Number(body.lead_time_days));
    if (body.active !== undefined) patch.active = Boolean(body.active);

    const { data, error } = await adminClient
      .from('gift_pool_sourced_items')
      .update(patch)
      .eq('id', id)
      .select(SELECT)
      .single();

    if (error) return jsonResponse(500, { success: false, error: error.message });
    return jsonResponse(200, { success: true, data });
  }

  if (event.httpMethod === 'POST') {
    const gfcId = body.gift_fulfilment_centre_id;
    const name = String(body.name || '').trim();
    if (!gfcId || !name) {
      return jsonResponse(400, { success: false, error: 'gift_fulfilment_centre_id and name required' });
    }

    const row = {
      gift_fulfilment_centre_id: gfcId,
      name,
      sku: body.sku ? String(body.sku).trim() : null,
      description: body.description ? String(body.description).trim() : null,
      image_url: body.image_url ? String(body.image_url).trim() : null,
      gift_category: body.gift_category ? String(body.gift_category).trim() : null,
      gift_program_cost: Math.max(0, Number(body.gift_program_cost || 0)),
      contribution_weight: Math.max(
        0,
        Number(body.contribution_weight ?? body.gift_program_cost ?? 0)
      ),
      available_qty: Math.max(0, Number(body.available_qty ?? 0)),
      lead_time_days: Math.max(0, Number(body.lead_time_days ?? 0)),
      active: body.active !== false,
    };

    const { data, error } = await adminClient
      .from('gift_pool_sourced_items')
      .insert(row)
      .select(SELECT)
      .single();

    if (error) return jsonResponse(500, { success: false, error: error.message });
    return jsonResponse(201, { success: true, data });
  }

  return jsonResponse(405, { success: false, error: 'Method not allowed' });
}
