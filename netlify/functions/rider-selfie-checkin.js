/**
 * POST /.netlify/functions/rider-selfie-checkin
 * Body: { selfie_url }
 *
 * Refreshes the rider's liveness selfie (the client uploads the photo to
 * the rider-documents bucket first, same as during KYC apply, then posts
 * the resulting public URL here). Clears the "go online" block enforced
 * by rider-online.js's freshness window.
 */
import { requireActiveRider, jsonResponse, headers } from './services/requireRider.js';
import { checkRateLimit } from './services/rate-limit.js';

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return jsonResponse(405, { success: false, error: 'Method not allowed' });

  const { limited, response } = await checkRateLimit(event, {
    name: 'rider-selfie-checkin',
    max: 5,
    window: '10 m',
    retryAfterSeconds: 600,
  });
  if (limited) return response;

  const session = await requireActiveRider(event);
  if (session.errorResponse) return session.errorResponse;
  const { rider, adminClient } = session;

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return jsonResponse(400, { success: false, error: 'Invalid JSON' }); }

  const selfieUrl = typeof body.selfie_url === 'string' ? body.selfie_url.trim() : '';
  if (!selfieUrl) {
    return jsonResponse(400, { success: false, error: 'selfie_url is required' });
  }

  const { error } = await adminClient
    .from('riders')
    .update({ selfie_url: selfieUrl, selfie_captured_at: new Date().toISOString() })
    .eq('id', rider.id);

  if (error) {
    console.error('rider-selfie-checkin update error:', error);
    return jsonResponse(500, { success: false, error: 'Failed to save selfie' });
  }

  return jsonResponse(200, { success: true });
}
