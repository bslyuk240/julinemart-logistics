// Netlify Function: /api/activity-logs
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY ||
  process.env.VITE_SUPABASE_KEY;
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY;
const supabase = SERVICE_KEY ? createClient(SUPABASE_URL || '', SERVICE_KEY) : null;
const supabaseAuth = createClient(SUPABASE_URL || '', ANON_KEY || SERVICE_KEY || '');

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    if (!SUPABASE_URL || !SERVICE_KEY || !supabase) {
      console.error('Activity logs function misconfigured: missing Supabase env');
      return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: 'Server not configured' }) };
    }

    const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return { statusCode: 401, headers, body: JSON.stringify({ success: false, error: 'Unauthorized' }) };
    }
    const token = authHeader.split(' ')[1];
    const { data: authData, error: authError } = await supabaseAuth.auth.getUser(token);
    if (authError || !authData?.user) {
      return { statusCode: 401, headers, body: JSON.stringify({ success: false, error: 'Invalid token' }) };
    }
    const { data: profile } = await supabase
      .from('users')
      .select('role')
      .eq('id', authData.user.id)
      .single();
    if (!profile || profile.role !== 'admin') {
      return { statusCode: 403, headers, body: JSON.stringify({ success: false, error: 'Forbidden' }) };
    }

    const params = event.queryStringParameters || {};
    const parsedLimit = Number(params.limit ?? 100);
    const limit = Math.min(Number.isNaN(parsedLimit) ? 100 : parsedLimit, 500);
    const action = params.action;
    const source = params.source;
    const excludeWhatsapp = params.exclude_whatsapp !== 'false';

    let query = supabase
      .from('activity_logs')
      .select(`
        id,
        user_id,
        actor_email,
        action,
        resource_type,
        resource_id,
        details,
        ip_address,
        source,
        created_at,
        users:users(id, email, full_name, role)
      `)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (excludeWhatsapp) {
      query = query
        .not('action', 'ilike', 'whatsapp%')
        .not('resource_type', 'ilike', 'whatsapp%');
    }

    if (action && action !== 'all') {
      query = query.eq('action', action);
    }
    if (source && source !== 'all') {
      query = query.eq('source', source);
    }

    const { data, error } = await query;
    if (error) {
      if (error.code === 'PGRST205' || error.message?.includes('Could not find the table')) {
        console.warn('activity_logs table does not exist, returning empty array');
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: [] }) };
      }
      throw error;
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: data || [] }) };
  } catch (e) {
    console.error('Activity logs function error:', e);
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: [] }) };
  }
}
