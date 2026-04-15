/**
 * POST /.netlify/functions/vendor-branding-upload
 * Authenticated vendor only — uploads logo/banner to Storage using service role (bypasses Storage RLS).
 *
 * Body JSON: { kind: 'logo' | 'banner', file_base64: string, content_type?: string }
 */
import { corsHeaders, preflightResponse } from './services/cors.js';
import { authenticateVendor, getAdminClient } from './services/vendorAuth.js';

const MAX_BYTES = 4 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function extFromType(ct) {
  const t = String(ct || '').toLowerCase();
  if (t === 'image/jpeg' || t === 'image/jpg') return 'jpg';
  if (t === 'image/png') return 'png';
  if (t === 'image/webp') return 'webp';
  if (t === 'image/gif') return 'gif';
  return 'jpg';
}

function ensurePublicUrl(url) {
  if (!url || typeof url !== 'string') return '';
  const t = url.trim();
  if (t.includes('/storage/v1/object/public/')) return t;
  if (t.includes('/storage/v1/object/sign/')) return t;
  return t.replace(
    /(\/storage\/v1\/object\/)(?!public\/|sign\/)([^/]+)\//,
    '$1public/$2/'
  );
}

export async function handler(event) {
  const origin = event.headers?.origin || event.headers?.Origin || '';
  if (event.httpMethod === 'OPTIONS') return preflightResponse(origin);
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders(origin),
      body: JSON.stringify({ success: false, error: 'Method not allowed' }),
    };
  }

  const auth = await authenticateVendor(event);
  if (auth.error) {
    return {
      statusCode: 401,
      headers: corsHeaders(origin),
      body: JSON.stringify({ success: false, error: auth.error }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      headers: corsHeaders(origin),
      body: JSON.stringify({ success: false, error: 'Invalid JSON' }),
    };
  }

  const { kind, file_base64, content_type } = body;
  if (!kind || !['logo', 'banner'].includes(kind) || !file_base64) {
    return {
      statusCode: 400,
      headers: corsHeaders(origin),
      body: JSON.stringify({ success: false, error: 'kind (logo|banner) and file_base64 are required' }),
    };
  }

  const ct = content_type && ALLOWED_TYPES.has(String(content_type).toLowerCase())
    ? String(content_type).toLowerCase()
    : 'image/jpeg';
  if (!ALLOWED_TYPES.has(ct)) {
    return {
      statusCode: 400,
      headers: corsHeaders(origin),
      body: JSON.stringify({ success: false, error: 'Only JPEG, PNG, WebP, or GIF images are allowed' }),
    };
  }

  let buffer;
  try {
    buffer = Buffer.from(String(file_base64), 'base64');
  } catch {
    return {
      statusCode: 400,
      headers: corsHeaders(origin),
      body: JSON.stringify({ success: false, error: 'Invalid base64 payload' }),
    };
  }

  if (buffer.length > MAX_BYTES) {
    return {
      statusCode: 400,
      headers: corsHeaders(origin),
      body: JSON.stringify({ success: false, error: 'Image must be 4 MB or smaller' }),
    };
  }
  if (buffer.length < 16) {
    return {
      statusCode: 400,
      headers: corsHeaders(origin),
      body: JSON.stringify({ success: false, error: 'File is too small or empty' }),
    };
  }

  const ext = extFromType(ct);
  const path = `branding/${auth.vendor.id}/${kind}_${Date.now()}.${ext}`;
  const adminClient = getAdminClient();

  const { data, error } = await adminClient.storage.from('vendor-documents').upload(path, buffer, {
    contentType: ct,
    upsert: true,
  });

  if (error) {
    console.error('vendor-branding-upload storage error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders(origin),
      body: JSON.stringify({ success: false, error: error.message || 'Upload failed' }),
    };
  }

  const { data: pub } = adminClient.storage.from('vendor-documents').getPublicUrl(data.path);
  const publicUrl = ensurePublicUrl(pub.publicUrl);

  return {
    statusCode: 200,
    headers: corsHeaders(origin),
    body: JSON.stringify({ success: true, data: { publicUrl } }),
  };
}
