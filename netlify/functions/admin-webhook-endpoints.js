/**
 * Admin CRUD for outbound webhook destinations (e.g. the Skola Workforce
 * webhook URL + signing secret). The secret is write-only from the API's
 * perspective — GET/list never returns it, only whether one is set.
 *
 *   GET    /api/admin/webhook-endpoints         list (no secrets)
 *   POST   /api/admin/webhook-endpoints         { name, url, secret, event_types? } create
 *   PATCH  /api/admin/webhook-endpoints/:id      { url?, secret?, event_types?, is_active? } update
 *   DELETE /api/admin/webhook-endpoints/:id      remove
 */
import { requireAdmin, jsonResponse, parseJsonBody } from './services/global-sourcing-utils.js';
import { encryptSecret } from './services/secretsCrypto.js';
import { recordStaffAudit } from './services/auditLog.js';

const PUBLIC_FIELDS = 'id, name, url, event_types, is_active, created_at, updated_at';

function isValidHttpsUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' }, body: '' };
  }

  const auth = await requireAdmin(event, ['admin']);
  if (auth.errorResponse) return auth.errorResponse;
  const { adminClient, authUser } = auth;

  const path = String(event.path || '').replace(/^\/api\/admin\/webhook-endpoints\/?/, '').replace(/\/+$/, '');
  const id = path || null;

  if (event.httpMethod === 'GET' && !id) {
    const { data, error } = await adminClient.from('webhook_endpoints').select(`${PUBLIC_FIELDS}, secret_encrypted`).order('created_at', { ascending: false });
    if (error) return jsonResponse(500, { success: false, error: error.message });
    return jsonResponse(200, {
      success: true,
      data: (data || []).map(({ secret_encrypted, ...rest }) => ({ ...rest, secret_configured: Boolean(secret_encrypted) })),
    });
  }

  if (event.httpMethod === 'POST' && !id) {
    const body = parseJsonBody(event.body);
    if (body === null) return jsonResponse(400, { success: false, error: 'Invalid JSON body' });

    const name = String(body.name || '').trim();
    const url = String(body.url || '').trim();
    const secret = String(body.secret || '').trim();
    if (!name) return jsonResponse(400, { success: false, error: 'name is required' });
    if (!isValidHttpsUrl(url)) return jsonResponse(400, { success: false, error: 'url must be a valid https:// URL' });
    if (!secret) return jsonResponse(400, { success: false, error: 'secret is required' });

    const eventTypes = Array.isArray(body.event_types) ? body.event_types.map(String) : [];

    const { data, error } = await adminClient
      .from('webhook_endpoints')
      .insert({ name, url, secret_encrypted: encryptSecret(secret), event_types: eventTypes, created_by: authUser.id })
      .select(PUBLIC_FIELDS)
      .single();

    if (error) return jsonResponse(error.code === '23505' ? 409 : 500, { success: false, error: error.message });

    await recordStaffAudit(event, authUser, {
      action: 'WEBHOOK_ENDPOINT_CREATED',
      resource_type: 'webhook_endpoint',
      resource_id: data.id,
      details: { name, url },
    });

    return jsonResponse(201, { success: true, data });
  }

  if (event.httpMethod === 'PATCH' && id) {
    const body = parseJsonBody(event.body);
    if (body === null) return jsonResponse(400, { success: false, error: 'Invalid JSON body' });

    const updates = {};
    if (body.url !== undefined) {
      if (!isValidHttpsUrl(body.url)) return jsonResponse(400, { success: false, error: 'url must be a valid https:// URL' });
      updates.url = String(body.url).trim();
    }
    if (body.secret !== undefined && String(body.secret).trim()) {
      updates.secret_encrypted = encryptSecret(String(body.secret).trim());
    }
    if (Array.isArray(body.event_types)) updates.event_types = body.event_types.map(String);
    if (typeof body.is_active === 'boolean') updates.is_active = body.is_active;

    if (Object.keys(updates).length === 0) {
      return jsonResponse(400, { success: false, error: 'No valid fields to update' });
    }
    updates.updated_at = new Date().toISOString();

    const { data, error } = await adminClient.from('webhook_endpoints').update(updates).eq('id', id).select(PUBLIC_FIELDS).maybeSingle();
    if (error) return jsonResponse(500, { success: false, error: error.message });
    if (!data) return jsonResponse(404, { success: false, error: 'Webhook endpoint not found' });

    await recordStaffAudit(event, authUser, {
      action: 'WEBHOOK_ENDPOINT_UPDATED',
      resource_type: 'webhook_endpoint',
      resource_id: id,
      details: { fields: Object.keys(updates) },
    });

    return jsonResponse(200, { success: true, data });
  }

  if (event.httpMethod === 'DELETE' && id) {
    const { data, error } = await adminClient.from('webhook_endpoints').delete().eq('id', id).select('id, name').maybeSingle();
    if (error) return jsonResponse(500, { success: false, error: error.message });
    if (!data) return jsonResponse(404, { success: false, error: 'Webhook endpoint not found' });

    await recordStaffAudit(event, authUser, {
      action: 'WEBHOOK_ENDPOINT_DELETED',
      resource_type: 'webhook_endpoint',
      resource_id: data.id,
      details: { name: data.name },
    });

    return jsonResponse(200, { success: true, data: { id: data.id, deleted: true } });
  }

  return jsonResponse(405, { success: false, error: 'Method not allowed' });
};
