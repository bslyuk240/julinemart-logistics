/**
 * POST /.netlify/functions/rider-register-push
 * Registers a rider's FCM push token in the device_tokens table.
 * Body: { rider_id, fcm_token }
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, authorization, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { rider_id, fcm_token } = body;
  if (!rider_id || !fcm_token) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'rider_id and fcm_token are required' }) };
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from('device_tokens')
    .upsert(
      { customer_id: rider_id, fcm_token, platform: 'web', user_type: 'rider', updated_at: now, last_used_at: now },
      { onConflict: 'customer_id,fcm_token' }
    );

  if (error) {
    console.error('rider-register-push error:', error.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to register token' }) };
  }

  return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
};
