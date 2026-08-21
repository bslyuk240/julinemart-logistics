/**
 * GET /api/rider-withdrawals-admin
 * Admin-only: returns all rider withdrawal requests with rider info.
 * Mirrors vendor-withdrawals-admin.js — rider-withdrawals.js's own GET is
 * scoped to the authenticated rider (requireActiveRider), so staff need a
 * separate, admin-scoped listing endpoint the same way vendor payouts do.
 */
import { requireAdmin, jsonResponse, headers } from './services/global-sourcing-utils.js';

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'GET') return jsonResponse(405, { success: false, error: 'Method not allowed' });

  const auth = await requireAdmin(event, ['admin', 'manager', 'staff']);
  if (auth.errorResponse) return auth.errorResponse;
  const { adminClient } = auth;

  const { data, error } = await adminClient
    .from('rider_withdrawals')
    .select('*, rider:riders(full_name, email, phone)')
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) return jsonResponse(500, { success: false, error: error.message });
  return jsonResponse(200, { success: true, data });
}
