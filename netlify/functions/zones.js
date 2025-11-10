// Netlify Function: /api/zones
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL || '', SERVICE_KEY || '');

export async function handler(_event, _context) {
  try {
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
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      },
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
