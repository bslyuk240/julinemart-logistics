import { createClient } from '@supabase/supabase-js';
import { corsHeaders, preflightResponse } from './services/cors.js';
import { requireAdmin } from './services/global-sourcing-utils.js';
import { recordStaffAudit } from './services/auditLog.js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY,
);

function publicRow(row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    enabled: row.enabled,
    environment: row.environment,
    has_credentials: row.code === 'fez'
      ? Boolean(process.env.FEZ_API_KEY || process.env.FEZ_PASSWORD)
      : Boolean(process.env.SHIPBUBBLE_API_KEY || process.env.SHIPBUBBLE_SANDBOX_API_KEY || process.env.SHIPBUBBLE_LIVE_API_KEY),
    config: {
      category_id: row.config?.category_id || null,
    },
  };
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

      const updates = { updated_at: new Date().toISOString() };
      if (typeof body.enabled === 'boolean') updates.enabled = body.enabled;
      if (body.environment === 'sandbox' || body.environment === 'production') updates.environment = body.environment;
      if (body.config && typeof body.config === 'object') {
        const { data: current } = await supabase.from('shipping_providers').select('config').eq('code', code).maybeSingle();
        updates.config = { ...(current?.config || {}), ...body.config };
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
        details: updates,
      });

      return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: publicRow(data) }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
  } catch (error) {
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: error.message }) };
  }
};
