/**
 * Admin CRUD for gift fulfilment centres (consolidation hubs).
 *
 * GET    /api/admin-gift-fulfilment-centres
 * POST   /api/admin-gift-fulfilment-centres
 * PUT    /api/admin-gift-fulfilment-centres?id=<uuid>
 * PATCH  /api/admin-gift-fulfilment-centres?id=<uuid>  — deactivate (active=false)
 * DELETE /api/admin-gift-fulfilment-centres?id=<uuid>  — permanent delete (no boxes/orders/sessions)
 */
import { requireAdmin, adminClient, jsonResponse, headers } from './services/global-sourcing-utils.js';

const SELECT =
  'id, name, code, country, state, city, address, active, is_default, supported_delivery_zones, cutoff_time, same_day_supported, next_day_supported, created_at, updated_at';

function parseId(event) {
  return event.queryStringParameters?.id || null;
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const auth = await requireAdmin(event, ['admin', 'manager']);
  if (auth.errorResponse) return auth.errorResponse;

  if (event.httpMethod === 'GET') {
    const { data, error } = await adminClient
      .from('gift_fulfilment_centres')
      .select(SELECT)
      .order('is_default', { ascending: false })
      .order('name', { ascending: true });

    if (error) return jsonResponse(500, { success: false, error: error.message });
    return jsonResponse(200, { success: true, data: data || [] });
  }

  if (event.httpMethod === 'POST') {
    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return jsonResponse(400, { success: false, error: 'Invalid JSON' });
    }

    const name = String(body.name || '').trim();
    const code = String(body.code || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-|-$/g, '');
    const state = String(body.state || '').trim();
    const city = String(body.city || '').trim();

    if (!name || !code || !state || !city) {
      return jsonResponse(400, { success: false, error: 'name, code, state, and city are required' });
    }

    const row = {
      name,
      code,
      country: String(body.country || 'Nigeria').trim(),
      state,
      city,
      address: body.address ? String(body.address).trim() : null,
      active: body.active !== false,
      is_default: Boolean(body.is_default),
      supported_delivery_zones: Array.isArray(body.supported_delivery_zones)
        ? body.supported_delivery_zones
        : [],
      cutoff_time: body.cutoff_time || null,
      same_day_supported: Boolean(body.same_day_supported),
      next_day_supported: body.next_day_supported !== false,
    };

    const { data, error } = await adminClient
      .from('gift_fulfilment_centres')
      .insert(row)
      .select(SELECT)
      .single();

    if (error) {
      if (error.code === '23505') {
        return jsonResponse(400, { success: false, error: 'A hub with this code already exists' });
      }
      return jsonResponse(500, { success: false, error: error.message });
    }

    return jsonResponse(201, { success: true, data });
  }

  const id = parseId(event);
  if (!id) {
    return jsonResponse(400, { success: false, error: 'id query parameter required for update' });
  }

  if (event.httpMethod === 'PATCH') {
    const { data, error } = await adminClient
      .from('gift_fulfilment_centres')
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select(SELECT)
      .single();

    if (error) return jsonResponse(500, { success: false, error: error.message });
    if (!data) return jsonResponse(404, { success: false, error: 'Hub not found' });
    return jsonResponse(200, { success: true, data });
  }

  if (event.httpMethod === 'DELETE') {
    const { data: hub, error: loadErr } = await adminClient
      .from('gift_fulfilment_centres')
      .select('id, is_default')
      .eq('id', id)
      .maybeSingle();

    if (loadErr) return jsonResponse(500, { success: false, error: loadErr.message });
    if (!hub) return jsonResponse(404, { success: false, error: 'Hub not found' });
    if (hub.is_default) {
      return jsonResponse(409, {
        success: false,
        error: 'Cannot delete the default hub — set another hub as default first',
      });
    }

    const { error } = await adminClient.from('gift_fulfilment_centres').delete().eq('id', id);
    if (error) {
      if (error.code === '23503') {
        return jsonResponse(409, {
          success: false,
          error: 'Hub has gift boxes, gift orders, or build-your-own sessions — deactivate instead of deleting',
        });
      }
      return jsonResponse(500, { success: false, error: error.message });
    }

    return jsonResponse(200, { success: true });
  }

  if (event.httpMethod === 'PUT') {
    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return jsonResponse(400, { success: false, error: 'Invalid JSON' });
    }

    const patch = { updated_at: new Date().toISOString() };
    if (body.name != null) patch.name = String(body.name).trim();
    if (body.code != null) {
      patch.code = String(body.code)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-|-$/g, '');
    }
    if (body.country != null) patch.country = String(body.country).trim();
    if (body.state != null) patch.state = String(body.state).trim();
    if (body.city != null) patch.city = String(body.city).trim();
    if (body.address !== undefined) patch.address = body.address ? String(body.address).trim() : null;
    if (body.active !== undefined) patch.active = Boolean(body.active);
    if (body.is_default !== undefined) patch.is_default = Boolean(body.is_default);
    if (body.supported_delivery_zones !== undefined) {
      patch.supported_delivery_zones = Array.isArray(body.supported_delivery_zones)
        ? body.supported_delivery_zones
        : [];
    }
    if (body.cutoff_time !== undefined) patch.cutoff_time = body.cutoff_time || null;
    if (body.same_day_supported !== undefined) patch.same_day_supported = Boolean(body.same_day_supported);
    if (body.next_day_supported !== undefined) patch.next_day_supported = Boolean(body.next_day_supported);

    const { data, error } = await adminClient
      .from('gift_fulfilment_centres')
      .update(patch)
      .eq('id', id)
      .select(SELECT)
      .single();

    if (error) {
      if (error.code === '23505') {
        return jsonResponse(400, { success: false, error: 'A hub with this code already exists' });
      }
      return jsonResponse(500, { success: false, error: error.message });
    }
    if (!data) return jsonResponse(404, { success: false, error: 'Hub not found' });
    return jsonResponse(200, { success: true, data });
  }

  return jsonResponse(405, { success: false, error: 'Method not allowed' });
}
