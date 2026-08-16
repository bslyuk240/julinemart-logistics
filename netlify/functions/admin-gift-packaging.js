/**
 * Admin CRUD for gift packaging tiers (Build Your Own box size/price options).
 *
 * GET   /api/admin-gift-packaging
 * POST  /api/admin-gift-packaging
 * PUT   /api/admin-gift-packaging?id=<uuid>
 * PATCH /api/admin-gift-packaging?id=<uuid>  — toggle active
 *
 * No DELETE: gift_orders/gift_builder_sessions reference a tier with
 * ON DELETE SET NULL, so a hard delete would silently blank out the
 * packaging tier on past orders. Deactivate instead — inactive tiers
 * just stop showing up at checkout.
 */
import { requireAdmin, jsonResponse, headers } from './services/global-sourcing-utils.js';
import { recordStaffAudit } from './services/auditLog.js';

const SELECT = 'id, code, name, description, price, max_items, sort_order, active, created_at';

function slugifyCode(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const auth = await requireAdmin(event, ['admin', 'manager']);
  if (auth.errorResponse) return auth.errorResponse;
  const { adminClient } = auth;

  const id = event.queryStringParameters?.id || null;

  if (event.httpMethod === 'GET') {
    const { data, error } = await adminClient
      .from('gift_packaging_types')
      .select(SELECT)
      .order('sort_order', { ascending: true })
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
    const price = Number(body.price);
    const maxItems = Number(body.max_items);

    if (!name) return jsonResponse(400, { success: false, error: 'name is required' });
    if (!Number.isFinite(price) || price < 0) {
      return jsonResponse(400, { success: false, error: 'price must be a non-negative number' });
    }
    if (!Number.isFinite(maxItems) || maxItems < 1) {
      return jsonResponse(400, { success: false, error: 'max_items must be at least 1' });
    }

    const code = body.code ? slugifyCode(body.code) : slugifyCode(name);
    if (!code) return jsonResponse(400, { success: false, error: 'Could not derive a code from name' });

    const row = {
      code,
      name,
      description: body.description ? String(body.description).trim() : null,
      price,
      max_items: Math.round(maxItems),
      sort_order: Number.isFinite(Number(body.sort_order)) ? Math.round(Number(body.sort_order)) : 0,
      active: body.active !== false,
    };

    const { data, error } = await adminClient
      .from('gift_packaging_types')
      .insert(row)
      .select(SELECT)
      .single();

    if (error) {
      if (error.code === '23505') {
        return jsonResponse(400, { success: false, error: 'A packaging tier with this code already exists' });
      }
      return jsonResponse(500, { success: false, error: error.message });
    }

    await recordStaffAudit(event, auth.authUser, {
      action: 'GIFT_PACKAGING_CREATED',
      resource_type: 'gift_packaging_types',
      resource_id: data.id,
      details: { code: data.code, name: data.name, price: data.price, max_items: data.max_items },
    });

    return jsonResponse(201, { success: true, data });
  }

  if (!id) return jsonResponse(400, { success: false, error: 'id query parameter required' });

  if (event.httpMethod === 'DELETE') {
    const { data: existing, error: findErr } = await adminClient
      .from('gift_packaging_types')
      .select('id, code, name')
      .eq('id', id)
      .maybeSingle();

    if (findErr) return jsonResponse(500, { success: false, error: findErr.message });
    if (!existing) return jsonResponse(404, { success: false, error: 'Packaging tier not found' });

    const [{ count: orderCount }, { count: sessionCount }] = await Promise.all([
      adminClient
        .from('gift_orders')
        .select('id', { count: 'exact', head: true })
        .eq('gift_packaging_type_id', id),
      adminClient
        .from('gift_builder_sessions')
        .select('id', { count: 'exact', head: true })
        .eq('gift_packaging_type_id', id),
    ]);

    if ((orderCount || 0) > 0 || (sessionCount || 0) > 0) {
      return jsonResponse(400, {
        success: false,
        error: `Can't delete — used by ${orderCount || 0} order(s) and ${sessionCount || 0} builder session(s). Deactivate it instead.`,
      });
    }

    const { error: delErr } = await adminClient.from('gift_packaging_types').delete().eq('id', id);
    if (delErr) return jsonResponse(500, { success: false, error: delErr.message });

    await recordStaffAudit(event, auth.authUser, {
      action: 'GIFT_PACKAGING_DELETED',
      resource_type: 'gift_packaging_types',
      resource_id: id,
      details: { code: existing.code, name: existing.name },
    });

    return jsonResponse(200, { success: true, data: { id } });
  }

  if (event.httpMethod === 'PATCH') {
    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return jsonResponse(400, { success: false, error: 'Invalid JSON' });
    }

    const { data, error } = await adminClient
      .from('gift_packaging_types')
      .update({ active: body.active !== false })
      .eq('id', id)
      .select(SELECT)
      .single();

    if (error) return jsonResponse(500, { success: false, error: error.message });
    if (!data) return jsonResponse(404, { success: false, error: 'Packaging tier not found' });

    await recordStaffAudit(event, auth.authUser, {
      action: data.active ? 'GIFT_PACKAGING_ACTIVATED' : 'GIFT_PACKAGING_DEACTIVATED',
      resource_type: 'gift_packaging_types',
      resource_id: id,
      details: { code: data.code, name: data.name },
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
    if (body.name != null) {
      const name = String(body.name).trim();
      if (!name) return jsonResponse(400, { success: false, error: 'name cannot be empty' });
      patch.name = name;
    }
    if (body.code != null) {
      const code = slugifyCode(body.code);
      if (!code) return jsonResponse(400, { success: false, error: 'Invalid code' });
      patch.code = code;
    }
    if (body.description !== undefined) {
      patch.description = body.description ? String(body.description).trim() : null;
    }
    if (body.price != null) {
      const price = Number(body.price);
      if (!Number.isFinite(price) || price < 0) {
        return jsonResponse(400, { success: false, error: 'price must be a non-negative number' });
      }
      patch.price = price;
    }
    if (body.max_items != null) {
      const maxItems = Number(body.max_items);
      if (!Number.isFinite(maxItems) || maxItems < 1) {
        return jsonResponse(400, { success: false, error: 'max_items must be at least 1' });
      }
      patch.max_items = Math.round(maxItems);
    }
    if (body.sort_order != null && Number.isFinite(Number(body.sort_order))) {
      patch.sort_order = Math.round(Number(body.sort_order));
    }
    if (body.active !== undefined) patch.active = Boolean(body.active);

    if (Object.keys(patch).length === 0) {
      return jsonResponse(400, { success: false, error: 'No fields to update' });
    }

    const { data, error } = await adminClient
      .from('gift_packaging_types')
      .update(patch)
      .eq('id', id)
      .select(SELECT)
      .single();

    if (error) {
      if (error.code === '23505') {
        return jsonResponse(400, { success: false, error: 'A packaging tier with this code already exists' });
      }
      return jsonResponse(500, { success: false, error: error.message });
    }
    if (!data) return jsonResponse(404, { success: false, error: 'Packaging tier not found' });

    await recordStaffAudit(event, auth.authUser, {
      action: 'GIFT_PACKAGING_UPDATED',
      resource_type: 'gift_packaging_types',
      resource_id: id,
      details: { code: data.code, name: data.name, price: data.price, max_items: data.max_items, patch },
    });

    return jsonResponse(200, { success: true, data });
  }

  return jsonResponse(405, { success: false, error: 'Method not allowed' });
}
