/**
 * POST /.netlify/functions/vendor-kyc-upload-url
 * Body: { kind: 'id' | 'cac', ext }
 *
 * Vendor applicants aren't signed in when they register, so they can't write
 * to storage themselves. This hands out a one-time signed upload URL into the
 * private vendor-kyc bucket (nobody can read files there except staff, via
 * signed links). The applicant then sends the returned `path` to
 * vendor-register, which stores it on the application.
 */
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { corsHeaders, preflightResponse } from './services/cors.js';
import { checkRateLimit } from './services/rate-limit.js';

const BUCKET = 'vendor-kyc';
const KINDS = new Set(['id', 'cac']);
const EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'pdf']);

export async function handler(event) {
  const origin = event.headers?.origin || event.headers?.Origin || '';
  if (event.httpMethod === 'OPTIONS') return preflightResponse(origin);
  const respond = (statusCode, body) => ({ statusCode, headers: corsHeaders(origin), body: JSON.stringify(body) });
  if (event.httpMethod !== 'POST') return respond(405, { success: false, error: 'Method not allowed' });

  // Two documents per application; allow retries but not bulk junk uploads.
  const { limited, response } = await checkRateLimit(event, {
    name: 'vendor-kyc-upload-url',
    max: 10,
    window: '10 m',
    retryAfterSeconds: 600,
  });
  if (limited) return { ...response, headers: { ...response.headers, ...corsHeaders(origin) } };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { success: false, error: 'Invalid JSON' }); }

  const kind = String(body.kind || '');
  const ext = String(body.ext || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!KINDS.has(kind) || !EXTENSIONS.has(ext)) {
    return respond(400, { success: false, error: 'kind must be id or cac; file must be jpg, png, webp or pdf' });
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return respond(500, { success: false, error: 'Server not configured' });

  const path = `applications/${crypto.randomUUID()}/${kind}.${ext}`;
  const { data, error } = await createClient(supabaseUrl, serviceKey)
    .storage.from(BUCKET)
    .createSignedUploadUrl(path);
  if (error) {
    console.error('vendor-kyc-upload-url error:', error.message);
    return respond(500, { success: false, error: 'Could not prepare upload' });
  }

  return respond(200, { success: true, bucket: BUCKET, path: data.path, token: data.token });
}
