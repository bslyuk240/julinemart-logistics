/**
 * vendor-locations.js — PUBLIC endpoint
 * Returns all active approved vendor locations for the registration form.
 * The frontend uses this to build cascading state → city → LGA dropdowns.
 *
 * GET /.netlify/functions/vendor-locations
 *
 * Response:
 *   {
 *     locations: [
 *       {
 *         id, state, city, lga,
 *         supports_vendor_direct_fez,
 *         supports_vendor_to_hub,
 *         supports_local_delivery,
 *         fez_hub_name, fez_hub_address,
 *         vendor_pickup_surcharge
 *       }
 *     ],
 *     grouped: {
 *       [state]: {
 *         [city]: [ { id, lga, supports_vendor_direct_fez, ... } ]
 *       }
 *     }
 *   }
 */
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const anonKey    = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'GET')     return { statusCode: 405, headers: cors, body: 'Method Not Allowed' };

  // Use anon key — RLS policy allows public read of active locations
  const client = createClient(supabaseUrl, anonKey);

  const { data: locations, error } = await client
    .from('approved_vendor_locations')
    .select(`
      id,
      state,
      city,
      lga,
      supports_vendor_direct_fez,
      supports_vendor_to_hub,
      supports_local_delivery,
      fez_hub_name,
      fez_hub_address,
      vendor_pickup_surcharge,
      hubs ( name, address, city )
    `)
    .eq('status', 'active')
    .order('state')
    .order('city')
    .order('lga');

  if (error) {
    console.error('vendor-locations fetch error:', error);
    return {
      statusCode: 500,
      headers: cors,
      body: JSON.stringify({ error: 'Failed to load approved locations' }),
    };
  }

  // Build grouped structure for cascading dropdowns
  const grouped = {};
  for (const loc of locations) {
    if (!grouped[loc.state]) grouped[loc.state] = {};
    if (!grouped[loc.state][loc.city]) grouped[loc.state][loc.city] = [];
    // Resolve hub: JLO hub (primary) or Fez hub (fallback)
    const jloHub = loc.hubs;
    const hub_name    = jloHub?.name    || loc.fez_hub_name    || null;
    const hub_address = jloHub
      ? `${jloHub.address || ''}${jloHub.city ? ', ' + jloHub.city : ''}`.replace(/^,\s*/, '')
      : (loc.fez_hub_address || null);
    const hub_type = jloHub ? 'jlo' : (loc.fez_hub_name ? 'fez' : null);

    grouped[loc.state][loc.city].push({
      id:                          loc.id,
      lga:                         loc.lga,
      supports_vendor_direct_fez:  loc.supports_vendor_direct_fez,
      supports_vendor_to_hub:      loc.supports_vendor_to_hub,
      supports_local_delivery:     loc.supports_local_delivery,
      hub_name,
      hub_address,
      hub_type,
      // keep legacy fields for backward compat
      fez_hub_name:                loc.fez_hub_name,
      fez_hub_address:             loc.fez_hub_address,
      vendor_pickup_surcharge:     loc.vendor_pickup_surcharge,
    });
  }

  return {
    statusCode: 200,
    headers: { ...cors, 'Content-Type': 'application/json' },
    body: JSON.stringify({ locations, grouped }),
  };
};
