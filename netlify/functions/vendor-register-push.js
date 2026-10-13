/**
 * POST /.netlify/functions/vendor-register-push
 * Registers the signed-in vendor's FCM push token in the device_tokens table.
 * The vendor comes from the Bearer token, never from the body, so nobody can
 * subscribe a device to another vendor's order notifications.
 * (The vendor portal site has its own copy of this function, which it calls.)
 * Body: { fcm_token }
 */
import { authenticateVendor } from './services/vendorAuth.js';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, authorization, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const { vendor, adminClient, error: authError } = await authenticateVendor(event);
  if (authError) return { statusCode: 401, headers, body: JSON.stringify({ error: authError }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { fcm_token } = body;
  if (!fcm_token) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'fcm_token is required' }) };
  }

  const now = new Date().toISOString();
  const { error } = await adminClient
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
