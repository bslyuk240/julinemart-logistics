// Netlify Function: /api/calc-shipping
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL || '', SERVICE_KEY || '');

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: 'Method Not Allowed' }) };
  }
  try {
    const payload = JSON.parse(event.body || '{}');
    const state = payload.state || payload.deliveryState || payload.delivery_state;
    const city = payload.city || payload.deliveryCity || payload.delivery_city;
    const items = Array.isArray(payload.items) ? payload.items : [];
    const totalWeight = items.reduce((sum, it) => sum + Number(it.weight || 0) * Number(it.quantity || 1), 0);

    // Fetch zones and resolve state -> zone
    const { data: zones } = await supabase.from('zones').select('id, code, states');
    let zone = zones?.find((z) => Array.isArray(z.states) && state && z.states.includes(state));
    if (!zone && zones && zones.length > 0) zone = zones[0];

    if (!zone) {
      return { statusCode: 404, headers, body: JSON.stringify({ success: false, error: 'No zones configured' }) };
    }

    // Find a baseline shipping rate for the zone (choose the cheapest active)
    const { data: rates, error: ratesError } = await supabase
      .from('shipping_rates')
      .select('id, flat_rate, per_kg_rate')
      .eq('zone_id', zone.id)
      .eq('is_active', true)
      .order('flat_rate', { ascending: true })
      .limit(1);
    if (ratesError) throw ratesError;

    const rate = rates && rates[0] ? rates[0] : { flat_rate: 3500, per_kg_rate: 500 };
    const cost = Number(rate.flat_rate || 0) + Number(rate.per_kg_rate || 0) * Number(totalWeight || 0);

    const response = {
      success: true,
      data: {
        zoneCode: zone.code,
        destination: { state, city },
        totalWeight,
        flat_rate: rate.flat_rate || 0,
        per_kg_rate: rate.per_kg_rate || 0,
        totalShippingFee: cost
      }
    };
    return { statusCode: 200, headers, body: JSON.stringify(response) };
  } catch (e) {
    console.error('calc-shipping error:', e);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: 'Failed to calculate shipping' }) };
  }
}

