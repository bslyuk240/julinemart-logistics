/**
 * GET /api/discover-areas
 * Returns distinct states, cities, and public areas for local discovery filters.
 */
import { createClient } from '@supabase/supabase-js';
import { corsHeaders, preflightResponse } from './services/cors.js';

const adminClient = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return preflightResponse();
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  if (!adminClient) {
    return { statusCode: 503, headers: corsHeaders(), body: JSON.stringify({ success: false, error: 'Database not configured' }) };
  }

  try {
    const q = event.queryStringParameters || {};
    const stateFilter = q.state ? String(q.state).trim() : null;
    const cityFilter = q.city ? String(q.city).trim() : null;

    const { data: vendors, error: vErr } = await adminClient
      .from('vendors')
      .select('state, city, approved_location_id')
      .eq('is_active', true)
      .not('store_name', 'is', null);

    if (vErr) {
      return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ success: false, error: vErr.message }) };
    }

    const locIds = [...new Set((vendors || []).map((v) => v.approved_location_id).filter(Boolean))];
    let locations = [];
    if (locIds.length) {
      const { data: locs } = await adminClient
        .from('approved_vendor_locations')
        .select('id, state, city, public_area, supports_customer_pickup')
        .in('id', locIds);
      locations = locs || [];
    }

    const locById = new Map(locations.map((l) => [l.id, l]));

    const states = new Set();
    const citiesByState = new Map();
    const areasByCity = new Map();

    for (const v of vendors || []) {
      const loc = v.approved_location_id ? locById.get(v.approved_location_id) : null;
      const state = (loc?.state || v.state || '').trim();
      const city = (loc?.city || v.city || '').trim();
      const area = (loc?.public_area || '').trim();

      if (!state) continue;
      if (stateFilter && state.toLowerCase() !== stateFilter.toLowerCase()) continue;

      states.add(state);

      if (city) {
        if (!citiesByState.has(state)) citiesByState.set(state, new Set());
        citiesByState.get(state).add(city);

        if (cityFilter && city.toLowerCase() !== cityFilter.toLowerCase()) continue;

        if (area) {
          const key = `${state}::${city}`;
          if (!areasByCity.has(key)) areasByCity.set(key, new Set());
          areasByCity.get(key).add(area);
        }
      }
    }

    const payload = {
      states: [...states].sort((a, b) => a.localeCompare(b)),
      cities: stateFilter
        ? [...(citiesByState.get(stateFilter) || [])].sort((a, b) => a.localeCompare(b))
        : undefined,
      areas:
        stateFilter && cityFilter
          ? [...(areasByCity.get(`${stateFilter}::${cityFilter}`) || [])].sort((a, b) =>
              a.localeCompare(b)
            )
          : undefined,
    };

    return {
      statusCode: 200,
      headers: { ...corsHeaders(), 'Cache-Control': 'public, max-age=600' },
      body: JSON.stringify({ success: true, data: payload }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ success: false, error: err?.message || 'Server error' }),
    };
  }
}
