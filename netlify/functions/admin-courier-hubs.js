/**
 * Admin CRUD for courier-owned hub/depot locations (e.g. Fez's own hubs) —
 * distinct from `hubs`, which JulineMart itself operates. A courier hub is
 * just a name + address a vendor drops a parcel at, run entirely by the
 * courier. Used to populate the "Courier Hub" dropdown on the Vendor
 * Locations page instead of free-typing a name/address per location.
 *
 * GET   /api/admin-courier-hubs[?courier_id=<uuid>]
 * POST  /api/admin-courier-hubs
 * PUT   /api/admin-courier-hubs?id=<uuid>
 * PATCH /api/admin-courier-hubs?id=<uuid>  — toggle active
 * DELETE /api/admin-courier-hubs?id=<uuid> — blocked if referenced by an approved location
 */
import { requireAdmin, jsonResponse, headers } from './services/global-sourcing-utils.js';
import { recordStaffAudit } from './services/auditLog.js';

const SELECT = 'id, courier_id, name, address, city, state, phone, is_active, notes, created_at, couriers ( id, name, code )';

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const auth = await requireAdmin(event, ['admin', 'manager']);
  if (auth.errorResponse) return auth.errorResponse;
  const { adminClient } = auth;

  const id = event.queryStringParameters?.id || null;
  const courierId = event.queryStringParameters?.courier_id || null;

  if (event.httpMethod === 'GET') {
    let query = adminClient.from('courier_hubs').select(SELECT).order('city').order('name');
    if (courierId) query = query.eq('courier_id', courierId);

    const { data, error } = await query;
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
    const address = String(body.address || '').trim();
    const city = String(body.city || '').trim();
    const state = String(body.state || '').trim();
    const courierId2 = body.courier_id;

    if (!courierId2) return jsonResponse(400, { success: false, error: 'courier_id is required' });
    if (!name) return jsonResponse(400, { success: false, error: 'name is required' });
    if (!address) return jsonResponse(400, { success: false, error: 'address is required' });
    if (!city) return jsonResponse(400, { success: false, error: 'city is required' });
    if (!state) return jsonResponse(400, { success: false, error: 'state is required' });

    const row = {
      courier_id: courierId2,
      name,
      address,
      city,
      state,
      phone: body.phone ? String(body.phone).trim() : null,
      notes: body.notes ? String(body.notes).trim() : null,
      is_active: body.is_active !== false,
    };

    const { data, error } = await adminClient.from('courier_hubs').insert(row).select(SELECT).single();
    if (error) return jsonResponse(500, { success: false, error: error.message });

    await recordStaffAudit(event, auth.authUser, {
      action: 'COURIER_HUB_CREATED',
      resource_type: 'courier_hubs',
      resource_id: data.id,
      details: { name: data.name, city: data.city, courier_id: data.courier_id },
    });

    return jsonResponse(201, { success: true, data });
  }

  if (!id) return jsonResponse(400, { success: false, error: 'id query parameter required' });

  if (event.httpMethod === 'PATCH') {
    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return jsonResponse(400, { success: false, error: 'Invalid JSON' });
    }

    const { data, error } = await adminClient
      .from('courier_hubs')
      .update({ is_active: body.is_active !== false })
      .eq('id', id)
      .select(SELECT)
      .single();

    if (error) return jsonResponse(500, { success: false, error: error.message });
    if (!data) return jsonResponse(404, { success: false, error: 'Courier hub not found' });

    await recordStaffAudit(event, auth.authUser, {
      action: data.is_active ? 'COURIER_HUB_ACTIVATED' : 'COURIER_HUB_DEACTIVATED',
      resource_type: 'courier_hubs',
      resource_id: id,
      details: { name: data.name },
    });

    return jsonResponse(200, { success: true, data });
  }

  if (event.httpMethod === 'PUT') {
    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return jsonResponse(400, { success: false, error: 'Invalid JSON' });
    }

    const patch = {};
    if (body.courier_id != null) patch.courier_id = body.courier_id;
    if (body.name != null) {
      const name = String(body.name).trim();
      if (!name) return jsonResponse(400, { success: false, error: 'name cannot be empty' });
      patch.name = name;
    }
    if (body.address != null) {
      const address = String(body.address).trim();
      if (!address) return jsonResponse(400, { success: false, error: 'address cannot be empty' });
      patch.address = address;
    }
    if (body.city != null) patch.city = String(body.city).trim();
    if (body.state != null) patch.state = String(body.state).trim();
    if (body.phone !== undefined) patch.phone = body.phone ? String(body.phone).trim() : null;
    if (body.notes !== undefined) patch.notes = body.notes ? String(body.notes).trim() : null;
    if (body.is_active !== undefined) patch.is_active = Boolean(body.is_active);

    if (Object.keys(patch).length === 0) {
      return jsonResponse(400, { success: false, error: 'No fields to update' });
    }

    const { data, error } = await adminClient
      .from('courier_hubs')
      .update(patch)
      .eq('id', id)
      .select(SELECT)
      .single();

    if (error) return jsonResponse(500, { success: false, error: error.message });
    if (!data) return jsonResponse(404, { success: false, error: 'Courier hub not found' });

    await recordStaffAudit(event, auth.authUser, {
      action: 'COURIER_HUB_UPDATED',
      resource_type: 'courier_hubs',
      resource_id: id,
      details: { name: data.name, patch },
    });

    return jsonResponse(200, { success: true, data });
  }

  if (event.httpMethod === 'DELETE') {
    const { data: existing, error: findErr } = await adminClient
      .from('courier_hubs')
      .select('id, name')
      .eq('id', id)
      .maybeSingle();

    if (findErr) return jsonResponse(500, { success: false, error: findErr.message });
    if (!existing) return jsonResponse(404, { success: false, error: 'Courier hub not found' });

    const { count } = await adminClient
      .from('approved_vendor_locations')
      .select('id', { count: 'exact', head: true })
      .eq('courier_hub_id', id);

    if ((count || 0) > 0) {
      return jsonResponse(400, {
        success: false,
        error: `Can't delete — used by ${count} approved location(s). Deactivate it instead.`,
      });
    }

    const { error: delErr } = await adminClient.from('courier_hubs').delete().eq('id', id);
    if (delErr) return jsonResponse(500, { success: false, error: delErr.message });

    await recordStaffAudit(event, auth.authUser, {
      action: 'COURIER_HUB_DELETED',
      resource_type: 'courier_hubs',
      resource_id: id,
      details: { name: existing.name },
    });

    return jsonResponse(200, { success: true, data: { id } });
  }

  return jsonResponse(405, { success: false, error: 'Method not allowed' });
}
