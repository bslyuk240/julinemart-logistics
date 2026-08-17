/**
 * Admin queue for seller verification requests.
 * GET /api/admin-seller-verifications?status=pending|approved|rejected|all
 */
import { createClient } from '@supabase/supabase-js';
import { corsHeaders, preflightResponse } from './services/cors.js';

const adminClient = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

async function requireAdmin(event) {
  const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
  if (!authHeader.startsWith('Bearer ')) return { error: 'Unauthorized', status: 401 };

  const anonClient = createClient(
    process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
    process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '',
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data: { user }, error } = await anonClient.auth.getUser();
  if (error || !user) return { error: 'Invalid token', status: 401 };

  const { data: profile } = await adminClient.from('users').select('role').eq('id', user.id).single();
  if (!profile || !['admin', 'manager'].includes(profile.role)) {
    return { error: 'Forbidden', status: 403 };
  }
  return { user };
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return preflightResponse();
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const auth = await requireAdmin(event);
  if (auth.error) {
    return { statusCode: auth.status, headers: corsHeaders(), body: JSON.stringify({ error: auth.error }) };
  }

  try {
    const url = new URL(event.rawUrl);
    const status = url.searchParams.get('status') || 'pending';
    const type = url.searchParams.get('type');

    let query = adminClient
      .from('seller_verifications')
      .select(`
        id,
        vendor_id,
        verification_type,
        status,
        evidence,
        verified_at,
        reject_reason,
        created_at,
        updated_at,
        vendors ( id, store_name, email, city, state )
      `)
      .order('created_at', { ascending: false })
      .limit(100);

    if (status !== 'all') query = query.eq('status', status);
    if (type) query = query.eq('verification_type', type);

    const { data, error } = await query;
    if (error) throw error;

    const stats = {
      pending: 0,
      approved: 0,
      rejected: 0,
    };
    for (const row of data || []) {
      if (row.status in stats) stats[row.status] += 1;
    }

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({ success: true, data: data || [], stats }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ error: err?.message || 'Failed to load verifications' }),
    };
  }
}
