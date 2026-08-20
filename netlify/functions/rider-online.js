import { requireActiveRider, jsonResponse, headers } from './services/requireRider.js';
import { checkRateLimit } from './services/rate-limit.js';

// Daily liveness gate — a rider going online more than this long since their
// last selfie capture must recapture before they're allowed to see jobs.
const SELFIE_FRESHNESS_MS = 24 * 60 * 60 * 1000;

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return jsonResponse(405, { success: false, error: 'Method not allowed' });

  const { limited, response } = await checkRateLimit(event, {
    name: 'rider-online',
    max: 20,
    window: '1 m',
    retryAfterSeconds: 60,
  });
  if (limited) return response;

  const session = await requireActiveRider(event);
  if (session.errorResponse) return session.errorResponse;
  const { rider, adminClient } = session;

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return jsonResponse(400, { success: false, error: 'Invalid JSON' }); }

  const online = Boolean(body.online);

  if (online) {
    const capturedAt = rider.selfie_captured_at ? new Date(rider.selfie_captured_at).getTime() : 0;
    if (!capturedAt || Date.now() - capturedAt > SELFIE_FRESHNESS_MS) {
      return jsonResponse(403, {
        success: false,
        error: 'selfie_stale',
        message: 'Take a fresh selfie before going online.',
      });
    }
  }

  const { error } = await adminClient
    .from('riders')
    .update({ is_online: online, last_online_at: new Date().toISOString() })
    .eq('id', rider.id);

  if (error) {
    console.error('rider-online update error:', error);
    return jsonResponse(500, { success: false, error: 'Failed to update status' });
  }

  return jsonResponse(200, { success: true, data: { online } });
}
