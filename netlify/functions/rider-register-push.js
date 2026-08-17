/**
 * POST /.netlify/functions/rider-register-push
 * Registers the authenticated rider's own FCM push token in device_tokens.
 * Body: { fcm_token }
 *
 * rider_id comes from the session, never the request body — device_tokens
 * fans a push out to every token under a customer_id, so trusting a
 * client-supplied rider_id here would let anyone silently register their
 * own device against an arbitrary rider and start receiving that rider's
 * job-offer notifications.
 */
import { requireActiveRider, jsonResponse, headers } from './services/requireRider.js';

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return jsonResponse(405, { success: false, error: 'Method not allowed' });

  const session = await requireActiveRider(event);
  if (session.errorResponse) return session.errorResponse;
  const { rider, adminClient } = session;

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return jsonResponse(400, { success: false, error: 'Invalid JSON' }); }

  const fcm_token = typeof body.fcm_token === 'string' ? body.fcm_token.trim() : '';
  if (!fcm_token) {
    return jsonResponse(400, { success: false, error: 'fcm_token is required' });
  }

  const now = new Date().toISOString();
  const { error } = await adminClient
    .from('device_tokens')
    .upsert(
      { customer_id: rider.id, fcm_token, platform: 'web', user_type: 'rider', updated_at: now, last_used_at: now },
      { onConflict: 'customer_id,fcm_token' }
    );

  if (error) {
    console.error('rider-register-push error:', error.message);
    return jsonResponse(500, { success: false, error: 'Failed to register token' });
  }

  return jsonResponse(200, { success: true });
};
