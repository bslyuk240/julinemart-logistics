/**
 * vendor-application-delete.js — Admin only
 * Permanently deletes a vendor application record.
 *
 * POST /api/vendor-application-delete
 * Body: { application_id }
 */
import { corsHeaders, preflightResponse } from './services/cors.js';
import { requireAdmin } from './services/global-sourcing-utils.js';

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

  const auth = await requireAdmin(event, ['admin', 'manager']);
  if (auth.errorResponse) return auth.errorResponse;

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      headers: corsHeaders(origin),
      body: JSON.stringify({ success: false, error: 'Invalid JSON' }),
    };
  }

  const { application_id } = body;
  if (!application_id) {
    return {
      statusCode: 400,
      headers: corsHeaders(origin),
      body: JSON.stringify({ success: false, error: 'application_id is required' }),
    };
  }

  const { adminClient } = auth;

  // Verify it exists first
  const { data: app, error: fetchErr } = await adminClient
    .from('vendor_applications')
    .select('id, status')
    .eq('id', application_id)
    .maybeSingle();

  if (fetchErr || !app) {
    return {
      statusCode: 404,
      headers: corsHeaders(origin),
      body: JSON.stringify({ success: false, error: 'Application not found' }),
    };
  }

  const { error: deleteErr } = await adminClient
    .from('vendor_applications')
    .delete()
    .eq('id', application_id);

  if (deleteErr) {
    return {
      statusCode: 500,
      headers: corsHeaders(origin),
      body: JSON.stringify({ success: false, error: deleteErr.message }),
    };
  }

  return {
    statusCode: 200,
    headers: corsHeaders(origin),
    body: JSON.stringify({ success: true }),
  };
}
