/**
 * GET /api/vendor-product-meta?type=categories|tags
 * Returns dropdown data for vendor product form.
 */
import { corsHeaders, preflightResponse } from './services/cors.js';
import { authenticateVendor, getAdminClient } from './services/vendorAuth.js';

export async function handler(event) {
  const origin = event.headers?.origin || event.headers?.Origin || '';
  if (event.httpMethod === 'OPTIONS') return preflightResponse(origin);
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: 'Method not allowed' }) };

  const { error } = await authenticateVendor(event);
  if (error) return { statusCode: 401, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error }) };

  const type = event.queryStringParameters?.type;
  const adminClient = getAdminClient();

  try {
    if (type === 'categories') {
      const { data, error: qErr } = await adminClient.from('categories').select('id, name, slug, parent_id').order('name');
      if (qErr) return { statusCode: 500, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: qErr.message }) };
      return { statusCode: 200, headers: corsHeaders(origin), body: JSON.stringify({ success: true, data: data || [] }) };
    }
    if (type === 'tags') {
      const { data, error: qErr } = await adminClient.from('tags').select('id, name, slug').order('name');
      if (qErr) return { statusCode: 500, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: qErr.message }) };
      return { statusCode: 200, headers: corsHeaders(origin), body: JSON.stringify({ success: true, data: data || [] }) };
    }
    return { statusCode: 400, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: 'type must be categories or tags' }) };
  } catch (err) {
    return { statusCode: 500, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: err?.message }) };
  }
}
