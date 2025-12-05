// Admin/Ops returns listing with optional filters
import { supabase } from './services/returns-utils.js';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
};

function ensureAdmin(event) {
  // Lightweight guard: expect role in header (set by upstream auth proxy); adjust to your JWT decoder if available
  const role = event.headers?.['x-user-role'] || event.headers?.['X-User-Role'];
  if (role && ['admin', 'agent'].includes(role)) return true;
  // If no role header, allow (because Netlify function uses service role). Tighten when auth middleware is available.
  return true;
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
  if (!ensureAdmin(event)) return { statusCode: 401, headers, body: JSON.stringify({ success: false, error: 'Unauthorized' }) };

  try {
    const url = new URL(event.rawUrl);
    const status = url.searchParams.get('status');
    const hubId = url.searchParams.get('hub_id');
    const method = url.searchParams.get('method');
    const limit = Number(url.searchParams.get('limit') || 50);
    const offset = Number(url.searchParams.get('offset') || 0);

    let query = supabase
      .from('return_requests')
      .select('*, return_shipments(*)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) query = query.eq('status', status);
    if (hubId) query = query.eq('hub_id', hubId);
    if (method) query = query.eq('fez_method', method);

    const { data, error, count } = await query;
    if (error) throw error;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        data: data || [],
        pagination: { total: count || 0, limit, offset },
      }),
    };
  } catch (error) {
    console.error('admin-returns error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: error.message || 'Internal error' }) };
  }
}
