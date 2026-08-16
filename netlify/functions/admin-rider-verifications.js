/**
 * Admin queue for rider KYC applications — mirrors admin-seller-verifications.js's
 * shape, but reads directly off the riders table (riders don't have a
 * separate applications table; the row exists from submission and its
 * status column tracks the review state).
 *
 * GET /api/admin-rider-verifications?status=pending_review|active|rejected|suspended|all
 */
import { requireAdmin, jsonResponse, headers } from './services/global-sourcing-utils.js';

const SELECT = `
  id, full_name, email, phone, nin,
  id_document_url, selfie_url, selfie_captured_at,
  vehicle_type, vehicle_plate, vehicle_document_url,
  guarantor_name, guarantor_phone,
  approved_location_id, status, reject_reason, approved_at, created_at,
  approved_vendor_locations ( city, state )
`;

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'GET') return jsonResponse(405, { success: false, error: 'Method not allowed' });

  const auth = await requireAdmin(event, ['admin', 'manager']);
  if (auth.errorResponse) return auth.errorResponse;
  const { adminClient } = auth;

  const status = (event.queryStringParameters?.status || 'pending_review').toLowerCase();

  let query = adminClient.from('riders').select(SELECT).order('created_at', { ascending: false }).limit(200);
  if (status !== 'all') query = query.eq('status', status);

  const { data, error } = await query;
  if (error) return jsonResponse(500, { success: false, error: error.message });

  const { data: allStatuses } = await adminClient.from('riders').select('status');
  const stats = { pending_review: 0, active: 0, rejected: 0, suspended: 0 };
  for (const row of allStatuses || []) {
    if (row.status in stats) stats[row.status] += 1;
  }

  return jsonResponse(200, { success: true, data: data || [], stats });
}
