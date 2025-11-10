// Netlify Function: /api/activity-logs
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL || '', SERVICE_KEY || '');

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
    if (!SUPABASE_URL || !SERVICE_KEY) {
      console.error('Activity logs function misconfigured: missing Supabase env');
      return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: 'Server not configured' }) };
    }
    const url = new URL(event.rawUrl);
    const limit = Number(url.searchParams.get('limit') || 100);
    const action = url.searchParams.get('action') || undefined;

    let query = supabase
      .from('activity_logs')
      .select(`
        id,
        user_id,
        action,
        resource_type,
        resource_id,
        details,
        ip_address,
        created_at,
        users:users(id, email, full_name)
      `)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (action && action !== 'all') {
      query = query.eq('action', action);
    }

    const { data, error } = await query;
    if (error) throw error;

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: data || [] }) };
  } catch (e) {
    console.error('Activity logs function error:', e);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: 'Failed to fetch activity logs' }) };
  }
}
