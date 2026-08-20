/**
 * Rider's own profile — read-only KYC/account details for the Profile tab.
 * GET /api/rider-profile
 */
import { requireActiveRider, jsonResponse, headers } from './services/requireRider.js';

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'GET') return jsonResponse(405, { success: false, error: 'Method not allowed' });

  const auth = await requireActiveRider(event);
  if (auth.errorResponse) return auth.errorResponse;
  const { rider, adminClient } = auth;

  const { data: full, error } = await adminClient
    .from('riders')
    .select(
      `full_name, email, phone, vehicle_type, vehicle_plate, guarantor_name, guarantor_phone,
       status, selfie_url, selfie_captured_at, created_at,
       bank_name, bank_account_number, bank_account_name,
       pending_bank_name, pending_bank_account_number, pending_bank_account_name, pending_bank_requested_at,
       approved_vendor_locations ( city, state )`
    )
    .eq('id', rider.id)
    .single();

  if (error || !full) {
    return jsonResponse(500, { success: false, error: error?.message || 'Could not load profile' });
  }

  return jsonResponse(200, {
    success: true,
    data: {
      full_name: full.full_name,
      email: full.email,
      phone: full.phone,
      vehicle_type: full.vehicle_type,
      vehicle_plate: full.vehicle_plate,
      guarantor_name: full.guarantor_name,
      guarantor_phone: full.guarantor_phone,
      status: full.status,
      selfie_url: full.selfie_url,
      selfie_captured_at: full.selfie_captured_at,
      member_since: full.created_at,
      bank_name: full.bank_name,
      bank_account_number: full.bank_account_number,
      bank_account_name: full.bank_account_name,
      pending_bank_change: full.pending_bank_name
        ? {
            bank_name: full.pending_bank_name,
            bank_account_number: full.pending_bank_account_number,
            bank_account_name: full.pending_bank_account_name,
            requested_at: full.pending_bank_requested_at,
          }
        : null,
      town: full.approved_vendor_locations
        ? [full.approved_vendor_locations.city, full.approved_vendor_locations.state].filter(Boolean).join(', ')
        : null,
    },
  });
}
