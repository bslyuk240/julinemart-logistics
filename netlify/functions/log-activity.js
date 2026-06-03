/**
 * POST /api/log-activity
 * Records a user action from the PWA storefront or vendor portal.
 *
 * Body:
 *   action        : string   e.g. 'LOGIN', 'ORDER_PLACED', 'SIGNUP'
 *   resource_type : string?  e.g. 'orders', 'customers'
 *   resource_id   : string?  uuid of the affected record
 *   details       : object?  arbitrary extra data
 *   source        : 'storefront' | 'vendor_portal'
 */
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';
const anonKey     = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ALLOWED_SOURCES = ['storefront', 'vendor_portal', 'jlo'];

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: 'Method Not Allowed' };

  if (!supabaseUrl || !serviceKey || !anonKey) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'Server not configured' }) };
  }

  const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  // Verify caller JWT
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await callerClient.auth.getUser();
  if (authErr || !user) {
    return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'Invalid token' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { action, resource_type, resource_id, details, source } = body;

  if (!action?.trim()) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'action is required' }) };
  }
  const actionNorm = action.trim().toUpperCase();
  if (actionNorm.startsWith('WHATSAPP') || String(resource_type || '').toLowerCase().startsWith('whatsapp')) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'WhatsApp activity logging is disabled' }) };
  }
  if (source && !ALLOWED_SOURCES.includes(source)) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'source must be storefront | vendor_portal | jlo' }) };
  }

  const ip = event.headers?.['x-forwarded-for']?.split(',')[0]?.trim()
    || event.headers?.['client-ip']
    || null;
  const userAgent = event.headers?.['user-agent'] || null;

  const adminClient = createClient(supabaseUrl, serviceKey);
  const row = {
    user_id:       user.id,
    actor_email:   user.email,
    action:        actionNorm,
    resource_type: resource_type || null,
    resource_id:   resource_id   || null,
    details:       details       || null,
    source:        source        || 'storefront',
    ip_address:    ip,
    user_agent:    userAgent,
  };

  const insertWithFallback = async () => {
    let candidate = { ...row };

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const { error } = await adminClient.from('activity_logs').insert(candidate);
      if (!error) return null;
      if (error.code !== 'PGRST204') return error;

      const message = error.message || '';
      if (message.includes('user_agent')) {
        const { user_agent, ...next } = candidate;
        candidate = next;
        continue;
      }
      if (message.includes('actor_email')) {
        const { actor_email, ...next } = candidate;
        candidate = next;
        continue;
      }
      if (message.includes('source')) {
        const { source, ...next } = candidate;
        candidate = next;
        continue;
      }
      return error;
    }

    return null;
  };

  const insertErr = await insertWithFallback();

  if (insertErr) {
    console.error('[log-activity] insert error:', insertErr.message);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'Failed to log activity' }) };
  }

  return {
    statusCode: 200,
    headers: { ...cors, 'Content-Type': 'application/json' },
    body: JSON.stringify({ success: true }),
  };
};
