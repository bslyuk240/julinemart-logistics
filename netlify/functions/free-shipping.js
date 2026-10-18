// Netlify Function: /.netlify/functions/free-shipping
// Public read of the live nationwide free-shipping offer, so storefronts can
// advertise exactly what calc-shipping will apply. Mirrors applyDiscounts in
// calc-shipping.js: active, inside its date window, type "free", all states.
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
const supabase = createClient(SUPABASE_URL || '', SERVICE_KEY || '');

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Cache-Control': 'public, max-age=300',
};

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
  }

  try {
    const { data, error } = await supabase
      .from('shipping_discounts')
      .select('type, min_order_value, states, start_date, end_date')
      .eq('is_active', true);
    if (error) throw error;

    const now = new Date();
    let best = null;
    for (const discount of data || []) {
      if ((discount.type || '').toLowerCase() !== 'free') continue;
      if (discount.start_date && new Date(discount.start_date) > now) continue;
      if (discount.end_date && new Date(discount.end_date) < now) continue;
      // State-limited offers can't be advertised site-wide.
      if (Array.isArray(discount.states) && discount.states.length > 0) continue;

      const minOrderValue = Number(discount.min_order_value ?? 0);
      if (!Number.isFinite(minOrderValue) || minOrderValue < 0) continue;
      if (!best || minOrderValue < best.minOrderValue) {
        best = { minOrderValue, endDate: discount.end_date || null };
      }
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: best }) };
  } catch (e) {
    console.error('free-shipping failed:', e?.message || e);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: 'Failed to load free shipping offer' }) };
  }
}
