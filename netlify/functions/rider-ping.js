/**
 * Proof-of-life endpoint — confirms a rider's session resolves to a
 * riders row (any status, not just active) and reports which one, so the
 * client can render a dedicated screen for pending_review/rejected/
 * suspended instead of a single generic message. Also doubles as the
 * new-device check-in point: it fires on every app load, so a
 * client-persisted device_id passed here that isn't in the rider's known
 * list gets recorded and flagged to staff via activity_logs (no dedicated
 * admin UI yet — reuses Activity Logs).
 *
 * GET /api/rider-ping?device_id=...
 */
import { requireRider, jsonResponse, headers } from './services/requireRider.js';
import { checkRateLimit } from './services/rate-limit.js';

async function flagIfNewDevice(adminClient, rider, deviceId, userAgent) {
  if (!deviceId) return;
  const known = Array.isArray(rider.known_device_ids) ? rider.known_device_ids : [];
  if (known.includes(deviceId)) return;

  await adminClient
    .from('riders')
    .update({ known_device_ids: [...known, deviceId] })
    .eq('id', rider.id);

  await adminClient.from('activity_logs').insert({
    user_id: null,
    action: 'RIDER_NEW_DEVICE_LOGIN',
    resource_type: 'rider',
    resource_id: rider.id,
    details: { device_id: deviceId, rider_name: rider.full_name },
    user_agent: userAgent || null,
    actor_email: rider.email,
    source: 'rider_app',
  });
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'GET') return jsonResponse(405, { success: false, error: 'Method not allowed' });

  const { limited, response } = await checkRateLimit(event, {
    name: 'rider-ping',
    max: 20,
    window: '1 m',
    retryAfterSeconds: 60,
  });
  if (limited) return response;

  const auth = await requireRider(event);
  if (auth.errorResponse) return auth.errorResponse;
  const { rider, adminClient } = auth;

  const deviceId = event.queryStringParameters?.device_id || null;
  try {
    await flagIfNewDevice(adminClient, rider, deviceId, event.headers?.['user-agent']);
  } catch (err) {
    console.error('rider-ping device flag error:', err);
  }

  return jsonResponse(200, {
    success: true,
    data: {
      rider_id: rider.id,
      status: rider.status,
      reject_reason: rider.reject_reason || null,
      created_at: rider.created_at,
    },
  });
}
