/**
 * Bearer-token auth for the external service API (/api/v1/*) — distinct from
 * requireAdmin (staff Supabase session) and authenticateVendor (vendor
 * Supabase session). Tokens are minted by admin-service-api-keys.js and
 * never stored in recoverable form: only a SHA-256 hash is kept, so this
 * module can only ever check equality, never issue or reveal a token.
 */
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';

let adminClient = null;
export function getServiceApiAdminClient() {
  if (!adminClient && supabaseUrl && serviceKey) {
    adminClient = createClient(supabaseUrl, serviceKey);
  }
  return adminClient;
}

export function hashApiKey(token) {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

export function jsonError(statusCode, message) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: message }),
  };
}

/**
 * @param {object} event - Netlify function event
 * @param {string|string[]|undefined} requiredCapability - a capability id
 *   (e.g. 'orders.read'), an array meaning "any one of these" (used where
 *   several capability ids map to the same route, e.g. shipments.read /
 *   shipments.track), or omitted entirely for routes that only need *some*
 *   valid active key with no specific capability (e.g. the manifest
 *   discovery route) — every request still needs a real, active key;
 *   omitting this only skips the per-capability scope check.
 * @returns {Promise<{ errorResponse?: object, apiKey?: object, adminClient?: object }>}
 */
export async function authenticateServiceApiRequest(event, requiredCapability) {
  const client = getServiceApiAdminClient();
  if (!client) {
    return { errorResponse: jsonError(500, 'Server not configured') };
  }

  const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
  if (!authHeader.startsWith('Bearer ') || authHeader.length <= 7) {
    return { errorResponse: jsonError(401, 'Missing or malformed Authorization bearer token') };
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return { errorResponse: jsonError(401, 'Missing or malformed Authorization bearer token') };
  }

  const tokenHash = hashApiKey(token);
  const { data: apiKey, error } = await client
    .from('service_api_keys')
    .select('id, name, scopes, is_active')
    .eq('key_hash', tokenHash)
    .maybeSingle();

  if (error || !apiKey || !apiKey.is_active) {
    return { errorResponse: jsonError(401, 'Invalid or revoked API key') };
  }

  if (requiredCapability) {
    const required = Array.isArray(requiredCapability) ? requiredCapability : [requiredCapability];
    const granted = required.some((cap) => apiKey.scopes.includes(cap));
    if (!granted) {
      return { errorResponse: jsonError(403, `API key is not granted any of: ${required.join(', ')}`) };
    }
  }

  // Fire-and-forget usage tracking — never block/fail the request on this.
  client
    .from('service_api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', apiKey.id)
    .then(() => {}, () => {});

  return { apiKey, adminClient: client };
}
