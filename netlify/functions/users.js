// Netlify Function: /api/users and /api/users/:id
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;
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

  const parts = event.path.split('/');
  const idx = parts.findIndex((p) => p === 'users');
  const id = idx >= 0 && parts.length > idx + 1 ? parts[idx + 1] : undefined;

  try {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      console.error('Users function misconfigured: missing Supabase env');
      return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: 'Server not configured' }) };
    }
    if (event.httpMethod === 'GET' && !id) {
      const { data, error } = await supabase
        .from('users')
        .select('id, email, full_name, role, is_active, last_login, created_at')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: data || [] }) };
    }

    if (event.httpMethod === 'DELETE' && id) {
      // Soft-delete: deactivate user
      const { error } = await supabase
        .from('users')
        .update({ is_active: false })
        .eq('id', id);
      if (error) throw error;
      return { statusCode: 204, headers, body: '' };
    }

    if (event.httpMethod === 'PUT' && id) {
      const payload = JSON.parse(event.body || '{}');
      const updateData = {};
      if (payload.full_name !== undefined) updateData.full_name = payload.full_name;
      if (payload.role !== undefined) updateData.role = payload.role;
      if (payload.is_active !== undefined) updateData.is_active = payload.is_active;

      const { data, error } = await supabase
        .from('users')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, data }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: 'Method Not Allowed' }) };
  } catch (e) {
    console.error('Users function error:', e);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: 'Failed to handle users', message: e?.message || 'Unknown error' }) };
  }
}
