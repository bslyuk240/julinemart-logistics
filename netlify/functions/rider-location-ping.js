/**
 * POST /.netlify/functions/rider-location-ping
 * Body: { lat, lng, accuracy? }
 *
 * Scoped tracking: a ping is only accepted while the rider has an active,
 * accepted assignment — enforced here server-side, not just by the client
 * only calling watchPosition while an ActiveDelivery screen is mounted.
 * No location history is kept, just the rider's last-known position.
 */
import { requireActiveRider, jsonResponse, headers } from './services/requireRider.js';

function isAccepted(metadata) {
  return Boolean(metadata && typeof metadata === 'object' && metadata.rider_accepted_at);
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return jsonResponse(405, { success: false, error: 'Method not allowed' });

  const session = await requireActiveRider(event);
  if (session.errorResponse) return session.errorResponse;
  const { rider, adminClient } = session;

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return jsonResponse(400, { success: false, error: 'Invalid JSON' }); }

  const lat = Number(body.lat);
  const lng = Number(body.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return jsonResponse(400, { success: false, error: 'lat and lng are required numbers' });
  }

  const { data: activeJobs, error: jobError } = await adminClient
    .from('sub_orders')
    .select('id, status, metadata')
    .eq('assigned_rider_id', rider.id)
    .in('status', ['assigned', 'picked_up', 'out_for_delivery']);

  if (jobError) {
    console.error('rider-location-ping job lookup error:', jobError);
    return jsonResponse(500, { success: false, error: 'Failed to verify assignment' });
  }

  const hasActiveAssignment = (activeJobs || []).some((so) => isAccepted(so.metadata));
  if (!hasActiveAssignment) {
    return jsonResponse(403, {
      success: false,
      error: 'no_active_assignment',
      message: 'Location is only tracked while you have an accepted delivery.',
    });
  }

  const { error: updateError } = await adminClient
    .from('riders')
    .update({ last_lat: lat, last_lng: lng, last_location_at: new Date().toISOString() })
    .eq('id', rider.id);

  if (updateError) {
    console.error('rider-location-ping update error:', updateError);
    return jsonResponse(500, { success: false, error: 'Failed to record location' });
  }

  return jsonResponse(200, { success: true });
}
