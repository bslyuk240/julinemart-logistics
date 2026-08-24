/**
 * Admin CRUD for external service API keys (the credentials that unlock
 * /api/v1/*, e.g. for the Skola Workforce "Custom API" integration).
 * The plaintext token is shown exactly once, in the create response — only
 * its SHA-256 hash is persisted (see serviceApiKeyAuth.js).
 *
 *   GET    /api/admin/service-api-keys        list (no secrets)
 *   POST   /api/admin/service-api-keys        { name, scopes: string[] } -> { token, ... } once
 *   DELETE /api/admin/service-api-keys/:id     revoke (soft — is_active=false)
 */
import crypto from 'crypto';
import { requireAdmin, jsonResponse, parseJsonBody } from './services/global-sourcing-utils.js';
import { hashApiKey } from './services/serviceApiKeyAuth.js';
import { recordStaffAudit } from './services/auditLog.js';
import { CAPABILITIES as CAPABILITY_CATALOG, getEnabledCapabilityIds } from './services/capabilityCatalog.js';

// The only capability ids a key can actually be granted — everything
// disabled in the catalog (roadmap items) is filtered out here too, not
// just at the route level, so an admin can't mint a key for a capability
// that doesn't have a working route yet.
const GRANTABLE_CAPABILITIES = getEnabledCapabilityIds();

function generateToken() {
  return `jlo_live_${crypto.randomBytes(32).toString('base64url')}`;
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' }, body: '' };
  }

  const auth = await requireAdmin(event, ['admin']);
  if (auth.errorResponse) return auth.errorResponse;
  const { adminClient, authUser } = auth;

  const path = String(event.path || '').replace(/^\/api\/admin\/service-api-keys\/?/, '').replace(/\/+$/, '');
  const keyId = path || null;

  if (event.httpMethod === 'GET' && !keyId) {
    const { data, error } = await adminClient
      .from('service_api_keys')
      .select('id, name, key_prefix, scopes, is_active, created_at, revoked_at, last_used_at')
      .order('created_at', { ascending: false });

    if (error) return jsonResponse(500, { success: false, error: error.message });
    // Full catalog (including disabled/roadmap entries) so the admin UI can
    // render them greyed-out rather than just omitting them silently.
    return jsonResponse(200, { success: true, data, capabilities: CAPABILITY_CATALOG });
  }

  if (event.httpMethod === 'POST' && !keyId) {
    const body = parseJsonBody(event.body);
    if (body === null) return jsonResponse(400, { success: false, error: 'Invalid JSON body' });

    const name = String(body.name || '').trim();
    if (!name) return jsonResponse(400, { success: false, error: 'name is required' });

    const scopes = Array.isArray(body.scopes) ? body.scopes.filter((s) => GRANTABLE_CAPABILITIES.includes(s)) : [];
    if (scopes.length === 0) {
      return jsonResponse(400, { success: false, error: `scopes must include at least one enabled capability: ${GRANTABLE_CAPABILITIES.join(', ')}` });
    }

    const token = generateToken();
    const keyPrefix = token.slice(0, 16);
    const keyHash = hashApiKey(token);

    const { data, error } = await adminClient
      .from('service_api_keys')
      .insert({ name, key_prefix: keyPrefix, key_hash: keyHash, scopes, created_by: authUser.id })
      .select('id, name, key_prefix, scopes, is_active, created_at')
      .single();

    if (error) return jsonResponse(500, { success: false, error: error.message });

    await recordStaffAudit(event, authUser, {
      action: 'SERVICE_API_KEY_CREATED',
      resource_type: 'service_api_key',
      resource_id: data.id,
      details: { name, scopes },
    });

    // token is returned exactly once — the DB only ever holds its hash.
    return jsonResponse(201, { success: true, data: { ...data, token } });
  }

  if (event.httpMethod === 'DELETE' && keyId) {
    const { data, error } = await adminClient
      .from('service_api_keys')
      .update({ is_active: false, revoked_at: new Date().toISOString() })
      .eq('id', keyId)
      .select('id, name')
      .maybeSingle();

    if (error) return jsonResponse(500, { success: false, error: error.message });
    if (!data) return jsonResponse(404, { success: false, error: 'API key not found' });

    await recordStaffAudit(event, authUser, {
      action: 'SERVICE_API_KEY_REVOKED',
      resource_type: 'service_api_key',
      resource_id: data.id,
      details: { name: data.name },
    });

    return jsonResponse(200, { success: true, data: { id: data.id, revoked: true } });
  }

  return jsonResponse(405, { success: false, error: 'Method not allowed' });
};
