// Netlify Function: /api/admin/notifications/send
// Required server-only env vars:
// - PWA_BASE_URL
// - NOTIFICATIONS_ADMIN_SECRET (used only for non-single audiences)
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
const VERIFY_KEY =
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_KEY ||
  process.env.VITE_SUPABASE_KEY ||
  SERVICE_ROLE_KEY;

const PWA_BASE_URL = process.env.PWA_BASE_URL;
const NOTIFICATIONS_ADMIN_SECRET = process.env.NOTIFICATIONS_ADMIN_SECRET;

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const ALLOWED_AUDIENCES = new Set([
  'single',
  'all_customers',
  'all_vendors',
  'all_staff',
  'segment',
]);
const BULK_AUDIENCES = new Set(['all_customers', 'all_vendors', 'all_staff', 'segment']);
const ALLOWED_TYPES = new Set(['order_update', 'product', 'promotion', 'general']);

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

const jsonResponse = (statusCode, body) => ({
  statusCode,
  headers,
  body: JSON.stringify(body),
});

const sanitizeBaseUrl = (url) => (url || '').replace(/\/+$/, '');

const parseBody = (rawBody) => {
  if (!rawBody) return {};
  try {
    return JSON.parse(rawBody);
  } catch {
    return null;
  }
};

const asFiniteNumber = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
};

const extractMetric = (source, keys) => {
  if (!isRecord(source)) return null;
  for (const key of keys) {
    const found = asFiniteNumber(source[key]);
    if (found !== null) return found;
  }
  return null;
};

const createSupabaseClients = () => {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !VERIFY_KEY) {
    return { error: 'Supabase credentials are missing' };
  }
  return {
    authClient: createClient(SUPABASE_URL, VERIFY_KEY),
    adminClient: createClient(SUPABASE_URL, SERVICE_ROLE_KEY),
  };
};

const authenticateRequest = async (event) => {
  const clients = createSupabaseClients();
  if (clients.error) return { error: jsonResponse(500, { success: false, error: clients.error }) };

  const authHeader = event.headers?.authorization || event.headers?.Authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { error: jsonResponse(401, { success: false, error: 'Missing bearer token' }) };
  }

  const token = authHeader.slice('Bearer '.length);

  const { data: authData, error: authError } = await clients.authClient.auth.getUser(token);
  if (authError || !authData?.user) {
    return { error: jsonResponse(401, { success: false, error: 'Invalid or expired token' }) };
  }

  const { data: profile, error: profileError } = await clients.adminClient
    .from('users')
    .select('id, email, role, is_active')
    .eq('id', authData.user.id)
    .single();

  if (profileError || !profile?.is_active) {
    return { error: jsonResponse(403, { success: false, error: 'User profile inactive or missing' }) };
  }

  return { profile };
};

const validatePayload = (payload) => {
  if (!isRecord(payload)) {
    return { error: 'Invalid JSON body' };
  }

  const audience = String(payload.audience || '');
  const title = String(payload.title || '').trim();
  const message = String(payload.message || '').trim();
  const type = String(payload.type || '').trim();
  const customerId = payload.customerId !== undefined ? String(payload.customerId).trim() : '';
  const scheduleAtRaw = payload.scheduleAt;
  const scheduleAt =
    scheduleAtRaw === undefined || scheduleAtRaw === null || String(scheduleAtRaw).trim() === ''
      ? null
      : String(scheduleAtRaw).trim();

  if (!ALLOWED_AUDIENCES.has(audience)) {
    return { error: 'Invalid audience' };
  }

  if (!ALLOWED_TYPES.has(type)) {
    return { error: 'Invalid type' };
  }

  if (!title) return { error: 'Title is required' };
  if (!message) return { error: 'Message is required' };

  if (audience === 'single' && !customerId) {
    return { error: 'customerId is required for audience=single' };
  }

  let segment = undefined;
  if (audience === 'segment') {
    if (!isRecord(payload.segment)) {
      return { error: 'segment object is required for audience=segment' };
    }
    const platform = payload.segment.platform ? String(payload.segment.platform).toLowerCase() : '';
    if (!platform || !['android', 'web'].includes(platform)) {
      return { error: 'segment.platform must be android or web' };
    }
    segment = { platform };
  }

  if (payload.data !== undefined && !isRecord(payload.data)) {
    return { error: 'data must be a JSON object when provided' };
  }

  if (scheduleAt && Number.isNaN(Date.parse(scheduleAt))) {
    return { error: 'scheduleAt must be a valid datetime string' };
  }

  const requestPayload = {
    audience,
    title,
    message,
    type,
    ...(isRecord(payload.data) ? { data: payload.data } : {}),
    ...(scheduleAt ? { scheduleAt } : {}),
    ...(audience === 'single' ? { customerId } : {}),
    ...(audience === 'segment' ? { segment } : {}),
  };

  return { requestPayload, audience };
};

const buildPwaHeaders = (audience) => {
  const upstreamHeaders = { 'Content-Type': 'application/json' };
  if (BULK_AUDIENCES.has(audience)) {
    if (!NOTIFICATIONS_ADMIN_SECRET) return { error: 'NOTIFICATIONS_ADMIN_SECRET is not configured' };
    upstreamHeaders['x-notifications-admin-secret'] = NOTIFICATIONS_ADMIN_SECRET;
  }
  return { upstreamHeaders };
};

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { success: false, error: 'Method not allowed' });
  }

  if (!PWA_BASE_URL) {
    return jsonResponse(500, { success: false, error: 'PWA_BASE_URL is not configured' });
  }

  const auth = await authenticateRequest(event);
  if (auth.error) return auth.error;

  const payload = parseBody(event.body);
  if (payload === null) {
    return jsonResponse(400, { success: false, error: 'Malformed JSON body' });
  }

  const validated = validatePayload(payload);
  if (validated.error) {
    return jsonResponse(400, { success: false, error: validated.error });
  }

  const isBulk = BULK_AUDIENCES.has(validated.audience);
  const role = auth.profile.role;

  if (isBulk && role !== 'admin') {
    return jsonResponse(403, {
      success: false,
      error: 'Only admin can send bulk or segment notifications',
    });
  }

  if (!isBulk && !['admin', 'agent'].includes(role)) {
    return jsonResponse(403, { success: false, error: 'Insufficient permissions' });
  }

  const headersResult = buildPwaHeaders(validated.audience);
  if (headersResult.error) {
    return jsonResponse(500, { success: false, error: headersResult.error });
  }

  const upstreamUrl = `${sanitizeBaseUrl(PWA_BASE_URL)}/api/notifications/send`;

  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      method: 'POST',
      headers: headersResult.upstreamHeaders,
      body: JSON.stringify(validated.requestPayload),
    });

    const raw = await upstreamResponse.text();
    let upstreamBody = {};
    try {
      upstreamBody = raw ? JSON.parse(raw) : {};
    } catch {
      upstreamBody = { raw };
    }

    if (!upstreamResponse.ok) {
      const upstreamMessage =
        isRecord(upstreamBody) && typeof upstreamBody.message === 'string'
          ? upstreamBody.message
          : null;
      return jsonResponse(upstreamResponse.status, {
        success: false,
        error: upstreamMessage || 'PWA notification service returned an error',
        upstream: upstreamBody,
      });
    }

    const metricSource = isRecord(upstreamBody.meta)
      ? upstreamBody.meta
      : isRecord(upstreamBody.data)
      ? upstreamBody.data
      : upstreamBody;

    // Upstream returned HTTP 200 but reported success: false (e.g. no devices matched)
    if (isRecord(upstreamBody) && upstreamBody.success === false) {
      return jsonResponse(200, {
        success: false,
        error:
          typeof upstreamBody.message === 'string'
            ? upstreamBody.message
            : 'Notification service returned failure',
        upstream: upstreamBody,
        meta: {
          audience: validated.audience,
          sent: extractMetric(metricSource, ['sent', 'sentCount', 'successCount']),
          failed: extractMetric(metricSource, ['failed', 'failedCount', 'errorCount']),
          matchedTokensCount: extractMetric(metricSource, [
            'matchedTokensCount',
            'matched_tokens_count',
            'matchedCount',
          ]),
        },
      });
    }

    return jsonResponse(200, {
      success: true,
      data: upstreamBody,
      meta: {
        audience: validated.audience,
        sent: extractMetric(metricSource, ['sent', 'sentCount', 'successCount']),
        failed: extractMetric(metricSource, ['failed', 'failedCount', 'errorCount']),
        matchedTokensCount: extractMetric(metricSource, [
          'matchedTokensCount',
          'matched_tokens_count',
          'matchedCount',
        ]),
      },
    });
  } catch (error) {
    return jsonResponse(500, {
      success: false,
      error: error instanceof Error ? error.message : 'Proxy request failed',
    });
  }
}
