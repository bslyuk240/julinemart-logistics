/**
 * POST /.netlify/functions/vendor-applications-list
 * Admin-only: list vendor KYC applications (service role — bypasses RLS).
 * Body: { status?: 'pending' | 'approved' | 'rejected' | 'all' }
 *
 * The dashboard cannot read vendor_applications with the anon key when RLS
 * blocks direct selects; registrations still succeed via vendor-register.
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

  const status = body.status;
  const { adminClient } = auth;

  let q = adminClient.from('vendor_applications').select('*').order('created_at', { ascending: false });
  if (status && status !== 'all') {
    q = q.eq('status', status);
  }

  const { data, error } = await q;
  if (error) {
    return {
      statusCode: 500,
      headers: corsHeaders(origin),
      body: JSON.stringify({ success: false, error: error.message }),
    };
  }

  return {
    statusCode: 200,
    headers: corsHeaders(origin),
    body: JSON.stringify({ success: true, applications: data || [] }),
  };
}
