/**
 * GET /.netlify/functions/admin-riders
 * Staff-facing roster: active riders grouped by the town they're approved
 * for, plus which local-delivery-eligible towns currently have zero
 * active riders — the actual gap this whole build exists to close.
 */
import { requireAdmin, jsonResponse, headers } from './services/global-sourcing-utils.js';

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'GET') return jsonResponse(405, { success: false, error: 'Method not allowed' });

  const auth = await requireAdmin(event, ['admin', 'manager']);
  if (auth.errorResponse) return auth.errorResponse;
  const { adminClient } = auth;

  const [{ data: riders, error: ridersError }, { data: locations, error: locationsError }] = await Promise.all([
    adminClient
      .from('riders')
      .select('id, full_name, phone, vehicle_type, vehicle_plate, is_online, last_online_at, approved_location_id, status')
      .eq('status', 'active'),
    adminClient
      .from('approved_vendor_locations')
      .select('id, city, state, hub_id, courier_hub_id, supports_local_delivery, status')
      .eq('supports_local_delivery', true)
      .eq('status', 'active'),
  ]);

  if (ridersError || locationsError) {
    console.error('admin-riders error:', ridersError || locationsError);
    return jsonResponse(500, { success: false, error: 'Failed to load roster' });
  }

  const ridersByLocation = new Map();
  for (const rider of riders || []) {
    if (!rider.approved_location_id) continue;
    const list = ridersByLocation.get(rider.approved_location_id) || [];
    list.push(rider);
    ridersByLocation.set(rider.approved_location_id, list);
  }

  const towns = (locations || []).map((loc) => {
    const townRiders = ridersByLocation.get(loc.id) || [];
    return {
      location_id: loc.id,
      city: loc.city,
      state: loc.state,
      has_jlo_hub: Boolean(loc.hub_id),
      has_courier_hub: Boolean(loc.courier_hub_id),
      rider_count: townRiders.length,
      online_count: townRiders.filter((r) => r.is_online).length,
      riders: townRiders.map((r) => ({
        id: r.id,
        full_name: r.full_name,
        phone: r.phone,
        vehicle_type: r.vehicle_type,
        vehicle_plate: r.vehicle_plate,
        is_online: r.is_online,
      })),
    };
  });

  const gaps = towns.filter((t) => t.rider_count === 0);

  return jsonResponse(200, {
    success: true,
    data: {
      towns: towns.sort((a, b) => a.rider_count - b.rider_count),
      gaps,
      stats: {
        total_towns: towns.length,
        covered_towns: towns.length - gaps.length,
        gap_towns: gaps.length,
        total_active_riders: (riders || []).length,
        online_riders: (riders || []).filter((r) => r.is_online).length,
      },
    },
  });
}
