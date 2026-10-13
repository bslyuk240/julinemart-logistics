/**
 * POST /.netlify/functions/vendor-register-push
 * Registers the signed-in vendor's FCM push token in device_tokens.
 * Requires the vendor's Bearer token; the vendor id comes from that session,
 * never from the request body, so nobody can subscribe a device to another
 * vendor's order notifications.
 * Body: { fcm_token }
 */
import { createClient } from '@supabase/supabase-js';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, authorization, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey || !anonKey) {
    console.error('vendor-register-push: missing Supabase env vars');
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server not configured' }) };
  }

  const auth = event.headers?.authorization || event.headers?.Authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid token' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { fcm_token } = body;
  if (!fcm_token) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'fcm_token is required' }) };
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  const { data: vendor } = await supabase
    .from('vendors')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!vendor) return { statusCode: 403, headers, body: JSON.stringify({ error: 'No vendor account' }) };

  const now = new Date().toISOString();
  const { error } = await supabase
    .from('device_tokens')
    .upsert(
      { customer_id: String(vendor.id), fcm_token, platform: 'web', user_type: 'vendor', updated_at: now, last_used_at: now },
      { onConflict: 'customer_id,fcm_token' }
    );

  if (error) {
    console.error('vendor-register-push error:', error.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to register token' }) };
  }

  return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
};
