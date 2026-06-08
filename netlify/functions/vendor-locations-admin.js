/**
 * vendor-locations-admin.js — Admin only
 * CRUD for approved_vendor_locations + read access to vendor_location_waitlist.
 *
 * GET    /.netlify/functions/vendor-locations-admin              — list all locations (all statuses)
 * POST   /.netlify/functions/vendor-locations-admin              — create location
 * PUT    /.netlify/functions/vendor-locations-admin              — update location
 * DELETE /.netlify/functions/vendor-locations-admin              — delete location
 * GET    /.netlify/functions/vendor-locations-admin?view=waitlist — list waitlist entries
 * GET    /.netlify/functions/vendor-locations-admin?view=waitlist&state=X&city=Y — filtered waitlist
 */
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
};

async function requireAdmin(event, adminClient) {
  const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
  if (!authHeader.startsWith('Bearer ')) return null;

  const anonClient = createClient(
    supabaseUrl,
    process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '',
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data: { user } } = await anonClient.auth.getUser();
  if (!user) return null;

  const { data: profile } = await adminClient.from('users').select('role').eq('id', user.id).single();
  if (!profile || !['admin', 'manager'].includes(profile.role)) return null;
  return user;
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };

  const adminClient = createClient(supabaseUrl, serviceKey);
  const user = await requireAdmin(event, adminClient);
  if (!user) return { statusCode: 403, headers: cors, body: JSON.stringify({ error: 'Forbidden' }) };

  const params = event.queryStringParameters || {};

  // ── GET ─────────────────────────────────────────────────────────────────────
  if (event.httpMethod === 'GET') {

    // Waitlist view
    if (params.view === 'waitlist') {
      let query = adminClient
        .from('vendor_location_waitlist')
        .select('*')
        .order('created_at', { ascending: false });

      if (params.state) query = query.eq('state', params.state);
      if (params.city)  query = query.eq('city', params.city);
      if (params.notified === 'false') query = query.is('notified_at', null);

      const { data, error } = await query;
      if (error) return { statusCode: 500, headers: cors, body: JSON.stringify({ error: error.message }) };
      return { statusCode: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ waitlist: data }) };
    }

    // Approved locations list (all statuses for admin)
    const { data, error } = await adminClient
      .from('approved_vendor_locations')
      .select(`
        *,
        hubs ( name, city, state ),
        couriers ( name, code ),
        zones ( name, code )
      `)
      .order('state')
      .order('city')
      .order('state');

    if (error) return { statusCode: 500, headers: cors, body: JSON.stringify({ error: error.message }) };
    return { statusCode: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ locations: data }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  // ── POST — create ────────────────────────────────────────────────────────────
  if (event.httpMethod === 'POST') {
    const {
      state, city, lgas, country,
      zone_id, hub_id, default_courier_id,
      fez_hub_name, fez_hub_address,
      supports_vendor_direct_fez,
      supports_vendor_to_hub,
      supports_local_delivery,
      vendor_pickup_surcharge,
      status, notes,
    } = body;

    const lgasArr = Array.isArray(lgas) ? lgas.filter(Boolean) : (lgas ? [lgas] : []);
    if (!state || !city || lgasArr.length === 0) {
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'state, city, and at least one LGA are required' }) };
    }

    const { data, error } = await adminClient
      .from('approved_vendor_locations')
      .insert({
        country:                     country || 'Nigeria',
        state, city, lgas: lgasArr,
        zone_id:                     zone_id || null,
        hub_id:                      hub_id || null,
        default_courier_id:          default_courier_id || null,
        fez_hub_name:                fez_hub_name || null,
        fez_hub_address:             fez_hub_address || null,
        supports_vendor_direct_fez:  supports_vendor_direct_fez ?? true,
        supports_vendor_to_hub:      supports_vendor_to_hub ?? false,
        supports_local_delivery:     supports_local_delivery ?? false,
        vendor_pickup_surcharge:     vendor_pickup_surcharge ?? 0,
        status:                      status || 'active',
        notes:                       notes || null,
      })
      .select()
      .single();

    if (error) {
      const isDuplicate = error.code === '23505';
      return {
        statusCode: isDuplicate ? 409 : 500,
        headers: cors,
        body: JSON.stringify({ error: isDuplicate ? `${city} (${state}) is already in the approved locations list.` : error.message }),
      };
    }
    return { statusCode: 201, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ location: data }) };
  }

  // ── PUT — update ─────────────────────────────────────────────────────────────
  if (event.httpMethod === 'PUT') {
    const { id, ...updates } = body;
    if (!id) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'id required' }) };

    // Strip fields that should not be user-patchable
    delete updates.created_at;

    const { data, error } = await adminClient
      .from('approved_vendor_locations')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) return { statusCode: 500, headers: cors, body: JSON.stringify({ error: error.message }) };
    return { statusCode: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ location: data }) };
  }

  // ── DELETE ───────────────────────────────────────────────────────────────────
  if (event.httpMethod === 'DELETE') {
    const { id } = body;
    if (!id) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'id required' }) };

    // Safety: check if vendors are registered under this location before deleting
    const { count } = await adminClient
      .from('vendors')
      .select('id', { count: 'exact', head: true })
      .eq('approved_location_id', id);

    if (count > 0) {
      return {
        statusCode: 409,
        headers: cors,
        body: JSON.stringify({
          error: `Cannot delete — ${count} vendor(s) are registered under this location. Pause it instead.`,
        }),
      };
    }

    const { error } = await adminClient.from('approved_vendor_locations').delete().eq('id', id);
    if (error) return { statusCode: 500, headers: cors, body: JSON.stringify({ error: error.message }) };
    return { statusCode: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ success: true }) };
  }

  return { statusCode: 405, headers: cors, body: 'Method Not Allowed' };
};
