// Netlify Function: /api/zones and /api/zones/:state
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL || '', SERVICE_KEY || '');

export async function handler(event, _context) {
  try {
    const headers = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, OPTIONS'
    };
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 200, headers, body: '' };
    }

    const parts = event.path.split('/');
    const idx = parts.findIndex((p) => p === 'zones');
    const arg = idx >= 0 && parts.length > idx + 1 ? parts[idx + 1] : undefined; // possible state

    // If state provided, resolve to zone
    if (event.httpMethod === 'GET' && arg) {
      const { data: zones } = await supabase.from('zones').select('code, name, states');
      const match = zones?.find((z) => Array.isArray(z.states) && z.states.includes(arg));
      if (!match) {
        return { statusCode: 404, headers, body: JSON.stringify({ success: false, error: 'State not mapped to zone' }) };
      }
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: match }) };
    }

    const { data, error } = await supabase
      .from('zones')
      .select(`
        *,
        shipping_rates (
          id,
          flat_rate,
          per_kg_rate,
          free_shipping_threshold,
          is_active
        )
      `)
      .order('name');
    if (error) throw error;
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, data: data || [] })
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      },
      body: JSON.stringify({ success: false, error: 'Failed to fetch zones' })
    };
  }
}
