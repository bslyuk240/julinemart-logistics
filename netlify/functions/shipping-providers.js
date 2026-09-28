import { createClient } from '@supabase/supabase-js';
import { corsHeaders, preflightResponse } from './services/cors.js';
import { requireAdmin } from './services/global-sourcing-utils.js';
import { recordStaffAudit } from './services/auditLog.js';
import { encryptSecret } from './services/secretsCrypto.js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY,
);

function isMaskedOrEmpty(value) {
  if (value == null) return true;
  const v = String(value).trim();
  return !v || /^•+$/.test(v);
}

function hasEncrypted(value) {
  return Boolean(value && String(value).startsWith('gcm:'));
}

function publicRow(row) {
  const config = row.config || {};
  const isFez = row.code === 'fez';
  const hasSandbox = hasEncrypted(config.sandbox_api_key_encrypted) || Boolean(process.env.SHIPBUBBLE_SANDBOX_API_KEY);
  const hasLive = hasEncrypted(config.live_api_key_encrypted) || Boolean(process.env.SHIPBUBBLE_API_KEY || process.env.SHIPBUBBLE_LIVE_API_KEY);
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    enabled: row.enabled,
    environment: row.environment,
    has_credentials: isFez
      ? Boolean(process.env.FEZ_API_KEY || process.env.FEZ_PASSWORD)
      : hasSandbox || hasLive,
    has_sandbox_key: isFez ? null : hasSandbox,
    has_live_key: isFez ? null : hasLive,
    has_webhook_secret: isFez ? null : hasEncrypted(config.webhook_secret_encrypted),
    config: {
      category_id: config.category_id || null,
      sender_email: config.sender_email || null,
      sender_phone: config.sender_phone || null,
    },
  };
}

function applySecretConfig(current, body) {
  const next = { ...(current || {}) };
  if (body.category_id !== undefined) next.category_id = String(body.category_id || '').trim() || null;
  if (body.sender_email !== undefined) next.sender_email = String(body.sender_email || '').trim() || null;
  if (body.sender_phone !== undefined) next.sender_phone = String(body.sender_phone || '').trim() || null;
  if (!isMaskedOrEmpty(body.sandbox_api_key)) {
    next.sandbox_api_key_encrypted = encryptSecret(String(body.sandbox_api_key).trim());
  }
  if (!isMaskedOrEmpty(body.live_api_key)) {
    next.live_api_key_encrypted = encryptSecret(String(body.live_api_key).trim());
  }
  if (!isMaskedOrEmpty(body.webhook_secret)) {
    next.webhook_secret_encrypted = encryptSecret(String(body.webhook_secret).trim());
  }
  return next;
}

export const handler = async (event) => {
  const headers = corsHeaders(event.headers?.origin || event.headers?.Origin);
  if (event.httpMethod === 'OPTIONS') return preflightResponse(event.headers?.origin || event.headers?.Origin);

  const admin = await requireAdmin(event, ['admin', 'manager']);
  if (admin.errorResponse) return { ...admin.errorResponse, headers };

  try {
    if (event.httpMethod === 'GET') {
      const { data, error } = await supabase.from('shipping_providers').select('*').order('code');
      if (error) throw error;
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: (data || []).map(publicRow) }) };
    }

    if (event.httpMethod === 'PATCH' || event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const code = String(body.code || '').toLowerCase();
      if (!['fez', 'shipbubble'].includes(code)) {
        return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Unknown provider code' }) };
      }

      const { data: current, error: loadError } = await supabase
        .from('shipping_providers')
        .select('*')
        .eq('code', code)
        .maybeSingle();
      if (loadError) throw loadError;
      if (!current) {
        return { statusCode: 404, headers, body: JSON.stringify({ success: false, error: 'Provider not found' }) };
      }

      const updates = { updated_at: new Date().toISOString() };
      if (typeof body.enabled === 'boolean') updates.enabled = body.enabled;
      if (body.environment === 'sandbox' || body.environment === 'production') updates.environment = body.environment;
      if (code === 'shipbubble') {
        updates.config = applySecretConfig(current.config, body);
      }

      const { data, error } = await supabase
        .from('shipping_providers')
        .update(updates)
        .eq('code', code)
        .select('*')
        .single();
      if (error) throw error;

      await recordStaffAudit(event, admin.authUser, {
        action: 'SHIPPING_PROVIDER_UPDATED',
        resource_type: 'shipping_provider',
        resource_id: code,
        details: {
          enabled: updates.enabled,
          environment: updates.environment,
          fields: Object.keys(body).filter((key) => !['sandbox_api_key', 'live_api_key', 'webhook_secret'].includes(key)),
          secrets_updated: ['sandbox_api_key', 'live_api_key', 'webhook_secret'].filter((key) => !isMaskedOrEmpty(body[key])),
        },
      });

      return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: publicRow(data) }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
  } catch (error) {
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: error.message }) };
  }
};
