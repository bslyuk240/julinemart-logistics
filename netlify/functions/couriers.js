// Netlify Function: /api/couriers
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from './services/global-sourcing-utils.js';
import { STAFF_READ_ROLES } from './services/shipmentAccess.js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL || '', SERVICE_KEY || '');

// Credential columns are written only by save-courier-credentials.js, which
// encrypts them. This endpoint never returns or accepts them.
const CREDENTIAL_COLUMNS = [
  'api_key_encrypted', 'api_secret_encrypted', 'api_credentials_encrypted',
  'api_key', 'api_secret', 'api_password', 'api_username', 'api_user_id',
];
const COURIER_COLUMNS =
  'id, name, code, type, is_active, api_enabled, api_base_url, environment, supports_tracking, supports_cod, ' +
  'supports_live_tracking, supports_label_generation, supports_rate_calculation, base_rate, rate_per_kg, ' +
  'service_zones, excluded_zones, average_delivery_time_days, success_rate, created_at, updated_at';

function withoutCredentials(payload) {
  const clean = { ...(payload || {}) };
  for (const col of CREDENTIAL_COLUMNS) delete clean[col];
  return clean;
}

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
};

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // Any staff member can list couriers (Shipping Rates and other screens pick
  // from them); everything else is admin-only, like the Couriers page.
  const parts = event.path.split('/');
  const idx = parts.findIndex((p) => p === 'couriers');
  const id = idx >= 0 && parts.length > idx + 1 ? parts[idx + 1] : undefined;
  const tail = idx >= 0 && parts.length > idx + 2 ? parts[idx + 2] : undefined; // e.g., 'credentials'
  const isList = event.httpMethod === 'GET' && !id;

  const auth = await requireAdmin(event, isList ? STAFF_READ_ROLES : ['admin']);
  if (auth.errorResponse) return auth.errorResponse;
  const isAdmin = auth.profile?.role === 'admin';

  try {
    if (event.httpMethod === 'GET') {
      if (id) {
        const { data, error } = await supabase
          .from('couriers')
          .select(COURIER_COLUMNS)
          .eq('id', id)
          .single();
        if (error) throw error;
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, data }) };
      }
      const { data, error } = await supabase
        .from('couriers')
        .select(isAdmin ? `${COURIER_COLUMNS}, api_key_encrypted` : COURIER_COLUMNS)
        .order('name');
      if (error) throw error;
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: data || [] }) };
    }

    if (event.httpMethod === 'POST') {
      const payload = withoutCredentials(JSON.parse(event.body || '{}'));
      const { data, error } = await supabase
        .from('couriers')
        .insert([payload])
        .select(COURIER_COLUMNS)
        .single();
      if (error) throw error;
      return { statusCode: 201, headers, body: JSON.stringify({ success: true, data }) };
    }

    // Retired: this stored secrets unencrypted. Credentials go through
    // save-courier-credentials, which encrypts them.
    if (event.httpMethod === 'PUT' && id && tail === 'credentials') {
      return {
        statusCode: 410,
        headers,
        body: JSON.stringify({ success: false, error: 'Use /.netlify/functions/save-courier-credentials to update courier credentials' }),
      };
    }

    if (event.httpMethod === 'PUT' && id) {
      const payload = withoutCredentials(JSON.parse(event.body || '{}'));
      const { data, error } = await supabase
        .from('couriers')
        .update(payload)
        .eq('id', id)
        .select(COURIER_COLUMNS)
        .single();
      if (error) throw error;
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, data }) };
    }

    if (event.httpMethod === 'DELETE' && id) {
      const { error } = await supabase
        .from('couriers')
        .delete()
        .eq('id', id);
      if (error) throw error;
      return { statusCode: 204, headers, body: '' };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: 'Method Not Allowed' }) };
  } catch (e) {
    console.error('Couriers function error:', e);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: 'Failed to handle couriers' }) };
  }
}
