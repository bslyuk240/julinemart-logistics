// Netlify Function: /api/hubs
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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
    const { data, error } = await supabase
      .from('hubs')
      .select('id, name, code, city, state, is_active')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: data || [] }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: 'Failed to fetch hubs' }) };
  }
}

