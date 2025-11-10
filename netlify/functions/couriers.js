// Netlify Function: /api/couriers
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
    const { data, error } = await supabase
      .from('couriers')
      .select('id, name, code, is_active')
      .order('name');
    if (error) throw error;
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: data || [] }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: 'Failed to fetch couriers' }) };
  }
}
