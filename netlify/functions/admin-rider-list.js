/**
 * GET /.netlify/functions/admin-rider-list
 * Full rider directory for the Riders management page — every rider
 * regardless of status, with contact info, area, online state, and
 * whatever they're currently out delivering. Distinct from:
 *  - admin-rider-verifications.js: the KYC approval queue (pending/active/
 *    rejected/suspended lists, capped to what a reviewer works through)
 *  - admin-riders.js: coverage-by-town rollup for the Roster page
 * This is the "manage my riders" list the other two don't provide.
 *
 * GET ?status=all|pending_review|active|suspended|rejected&search=
 */
import { requireAdmin, jsonResponse, headers } from './services/global-sourcing-utils.js';

const SELECT = `
  id, full_name, email, phone,
  vehicle_type, vehicle_plate,
  approved_location_id, status, is_online, last_online_at,
  created_at, approved_at,
  pending_bank_name, pending_bank_account_number, pending_bank_account_name, pending_bank_requested_at,
  pending_vehicle_type, pending_vehicle_plate, pending_vehicle_requested_at,
  approved_vendor_locations ( city, state )
`;

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'GET') return jsonResponse(405, { success: false, error: 'Method not allowed' });

  const auth = await requireAdmin(event, ['admin', 'manager']);
  if (auth.errorResponse) return auth.errorResponse;
  const { adminClient } = auth;

  const status = (event.queryStringParameters?.status || 'all').toLowerCase();
  const search = (event.queryStringParameters?.search || '').trim();

  let query = adminClient.from('riders').select(SELECT).order('created_at', { ascending: false });
  if (status !== 'all') query = query.eq('status', status);
  if (search) {
    const term = search.replace(/[%,]/g, '');
    query = query.or(`full_name.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%`);
  }

  const { data: riders, error } = await query;
  if (error) return jsonResponse(500, { success: false, error: error.message });

  const riderIds = (riders || []).map((r) => r.id);
  let currentJobByRider = new Map();
  if (riderIds.length) {
    const { data: activeShipments } = await adminClient
      .from('shipments')
      .select('assigned_rider_id, status, tracking_number')
      .in('assigned_rider_id', riderIds)
      .in('status', ['assigned', 'picked_up', 'out_for_delivery']);
    currentJobByRider = new Map((activeShipments || []).map((s) => [s.assigned_rider_id, { status: s.status, tracking_number: s.tracking_number }]));
  }

  const data = (riders || []).map((r) => ({
    id: r.id,
    full_name: r.full_name,
    email: r.email,
    phone: r.phone,
    vehicle_type: r.vehicle_type,
    vehicle_plate: r.vehicle_plate,
    status: r.status,
    is_online: r.is_online,
    last_online_at: r.last_online_at,
    created_at: r.created_at,
    approved_at: r.approved_at,
    area: r.approved_vendor_locations ? { city: r.approved_vendor_locations.city, state: r.approved_vendor_locations.state } : null,
    current_job: currentJobByRider.get(r.id) || null,
    pending_bank_change: r.pending_bank_name
      ? {
          bank_name: r.pending_bank_name,
          bank_account_number: r.pending_bank_account_number,
          bank_account_name: r.pending_bank_account_name,
          requested_at: r.pending_bank_requested_at,
        }
      : null,
    pending_vehicle_change: r.pending_vehicle_type
      ? {
          vehicle_type: r.pending_vehicle_type,
          vehicle_plate: r.pending_vehicle_plate,
          requested_at: r.pending_vehicle_requested_at,
        }
      : null,
  }));

  const stats = { pending_review: 0, active: 0, suspended: 0, rejected: 0, online: 0, pending_bank_change: 0, pending_vehicle_change: 0 };
  for (const r of data) {
    if (r.status in stats) stats[r.status] += 1;
    if (r.is_online) stats.online += 1;
    if (r.pending_bank_change) stats.pending_bank_change += 1;
    if (r.pending_vehicle_change) stats.pending_vehicle_change += 1;
  }

  return jsonResponse(200, { success: true, data, stats });
}
