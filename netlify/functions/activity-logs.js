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
    if (!profile || !['admin', 'manager'].includes(profile.role)) {
      return { statusCode: 403, headers, body: JSON.stringify({ success: false, error: 'Forbidden' }) };
    }

    const params = event.queryStringParameters || {};
    const parsedLimit = Number(params.limit ?? 200);
    const limit = Math.min(Number.isNaN(parsedLimit) ? 200 : parsedLimit, 500);
    const action = params.action;
    const source = params.source;
    const excludeWhatsapp = params.exclude_whatsapp !== 'false';

    const selectWithSource = 'id, user_id, actor_email, action, resource_type, resource_id, details, ip_address, source, created_at';
    const selectLegacy = 'id, user_id, action, resource_type, resource_id, details, ip_address, created_at';

    // Step 1: fetch logs (no FK join — user_id now refs auth.users, not public.users)
    const buildQuery = (selectColumns, includeSourceFilter = true, overrideLimit = limit) => {
      let query = supabase
        .from('activity_logs')
        .select(selectColumns)
        .order('created_at', { ascending: false })
        .limit(overrideLimit);

      if (excludeWhatsapp) {
        query = query
          .not('action', 'ilike', 'whatsapp%')
          .not('resource_type', 'ilike', 'whatsapp%');
      }
      if (action && action !== 'all') query = query.eq('action', action);
      if (includeSourceFilter && source && source !== 'all') query = query.eq('source', source);
      return query;
    };

    let { data: logs, error } = await buildQuery(selectWithSource);
    if (error) {
      if (error.code === 'PGRST205' || error.message?.includes('Could not find the table')) {
        console.warn('activity_logs table does not exist, returning empty array');
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: [] }) };
      }
      if (error.code === 'PGRST204' || error.message?.includes('actor_email') || error.message?.includes('source')) {
        const retry = await buildQuery(selectLegacy, true, limit);
        logs = retry.data;
        error = retry.error;
      }
    }

    if (error) throw error;

    // Step 2: enrich with public.users (JLO staff only — vendors/customers won't be there)
    const userIds = [...new Set((logs || []).map(l => l.user_id).filter(Boolean))];
    let usersMap = {};
    if (userIds.length) {
      const { data: users } = await supabase
        .from('users')
        .select('id, email, full_name, role')
        .in('id', userIds);
      usersMap = Object.fromEntries((users || []).map(u => [u.id, u]));
    }

    const data = (logs || []).map(log => ({
      ...log,
      users: usersMap[log.user_id] || null,
    }));

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, data }) };
  } catch (e) {
    console.error('Activity logs function error:', e);
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: [] }) };
  }
}
