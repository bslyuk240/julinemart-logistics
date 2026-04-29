// Fez Delivery - Register Webhook
// GET  → checks if webhook is already registered
// POST → registers the webhook with Fez (idempotent)
// Protected by ADMIN_SECRET env var

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, x-admin-secret',
  'Content-Type': 'application/json',
};

const WEBHOOK_URL = 'https://jlo.julinemart.com/.netlify/functions/fez-webhook';

async function getFezAuth() {
  const userId = process.env.FEZ_USER_ID;
  const password = process.env.FEZ_PASSWORD || process.env.FEZ_API_KEY;
  const baseUrl = process.env.FEZ_API_BASE_URL;

  if (!userId || !password || !baseUrl) {
    throw new Error('Missing FEZ_USER_ID / FEZ_PASSWORD / FEZ_API_BASE_URL env vars');
  }

  const res = await fetch(`${baseUrl}/user/authenticate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, password }),
  });

  const data = await res.json();
  if (data.status !== 'Success') {
    throw new Error(data.description || 'Fez authentication failed');
  }

  return {
    authToken: data.authDetails.authToken,
    secretKey: data.orgDetails['secret-key'],
    baseUrl,
  };
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  // Simple admin protection
  const adminSecret = process.env.ADMIN_SECRET;
  if (adminSecret) {
    const provided = event.headers['x-admin-secret'] || event.queryStringParameters?.secret;
    if (provided !== adminSecret) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
    }
  }

  try {
    const { authToken, secretKey, baseUrl } = await getFezAuth();

    if (event.httpMethod === 'GET') {
      // Check existing webhooks
      const res = await fetch(`${baseUrl}/webhooks`, {
        headers: { Authorization: `Bearer ${authToken}`, 'secret-key': secretKey },
      });
      const data = await res.json();
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, webhooks: data }),
      };
    }

    if (event.httpMethod === 'POST') {
      const res = await fetch(`${baseUrl}/webhooks/store`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
          'secret-key': secretKey,
        },
        body: JSON.stringify({ webhook: WEBHOOK_URL }),
      });
      const data = await res.json();
      console.log('Fez webhook registration response:', JSON.stringify(data));

      await supabase.from('activity_logs').insert({
        user_id: null,
        action: 'fez_webhook_registered',
        resource_type: 'system',
        resource_id: null,
        details: { webhook_url: WEBHOOK_URL, fez_response: data },
      });

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, webhook_url: WEBHOOK_URL, fez_response: data }),
      };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  } catch (err) {
    console.error('fez-register-webhook error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: err.message }),
    };
  }
}
