/**
 * Phase 0 proof-of-life endpoint — confirms a rider's session resolves to
 * an approved riders row. Superseded by rider-profile.js in Phase 1.
 *
 * GET /api/rider-ping
 */
import { requireActiveRider, jsonResponse, headers } from './services/requireRider.js';

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'GET') return jsonResponse(405, { success: false, error: 'Method not allowed' });

  const auth = await requireActiveRider(event);
  if (auth.errorResponse) return auth.errorResponse;

  return jsonResponse(200, {
    success: true,
    data: { rider_id: auth.rider.id, status: auth.rider.status },
  });
}
