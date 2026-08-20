/**
 * rider-profile-update.js — a rider requests a change to their own profile.
 *
 * POST /api/rider-profile-update
 * Body: { field: 'phone', phone }
 *     | { field: 'vehicle', vehicle_type, vehicle_plate }
 *     | { field: 'bank', bank_name, bank_account_number, bank_account_name }
 *
 * Phone is a plain contact detail — low risk, takes effect immediately.
 *
 * Vehicle type/plate and bank details are KYC-verified facts a rider was
 * approved against (what they're allowed to ride, where their payout goes)
 * — changing either silently would undermine that approval, so both go
 * through pending_vehicle_* / pending_bank_* instead and only take effect
 * once staff approves (rider-approve.js). See docs/rider-commission-design.md
 * §10 for why bank details specifically can't be an instant self-edit.
 */
import { requireActiveRider, jsonResponse, headers } from './services/requireRider.js';
import { checkRateLimit } from './services/rate-limit.js';

const ACCOUNT_NUMBER_RE = /^\d{10}$/;
const VEHICLE_TYPES = ['okada', 'keke', 'car', 'foot'];
// Nigerian phone numbers as already accepted at signup — 11 digits starting
// with 0, or +234 followed by 10 digits.
const PHONE_RE = /^(0\d{10}|\+234\d{10})$/;

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return jsonResponse(405, { success: false, error: 'Method not allowed' });

  const { limited, response } = await checkRateLimit(event, {
    name: 'rider-profile-update',
    max: 5,
    window: '10 m',
    retryAfterSeconds: 600,
  });
  if (limited) return response;

  const session = await requireActiveRider(event);
  if (session.errorResponse) return session.errorResponse;
  const { rider, adminClient } = session;

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return jsonResponse(400, { success: false, error: 'Invalid JSON' });
  }

  if (body.field === 'phone') {
    const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
    if (!PHONE_RE.test(phone)) {
      return jsonResponse(400, { success: false, error: 'Enter a valid Nigerian phone number' });
    }
    const { error } = await adminClient.from('riders').update({ phone }).eq('id', rider.id);
    if (error) return jsonResponse(500, { success: false, error: 'Failed to update phone number' });
    return jsonResponse(200, { success: true, message: 'Phone number updated' });
  }

  if (body.field === 'vehicle') {
    const vehicleType = typeof body.vehicle_type === 'string' ? body.vehicle_type : '';
    const vehiclePlate = typeof body.vehicle_plate === 'string' ? body.vehicle_plate.trim().toUpperCase() : '';
    if (!VEHICLE_TYPES.includes(vehicleType)) {
      return jsonResponse(400, { success: false, error: `vehicle_type must be one of: ${VEHICLE_TYPES.join(', ')}` });
    }
    if (!vehiclePlate) return jsonResponse(400, { success: false, error: 'vehicle_plate is required' });

    const { error } = await adminClient
      .from('riders')
      .update({
        pending_vehicle_type: vehicleType,
        pending_vehicle_plate: vehiclePlate,
        pending_vehicle_requested_at: new Date().toISOString(),
      })
      .eq('id', rider.id);
    if (error) return jsonResponse(500, { success: false, error: 'Failed to submit change request' });

    return jsonResponse(200, {
      success: true,
      message: 'Vehicle details submitted for review. Your current vehicle stays on file until this is approved.',
    });
  }

  if (body.field === 'bank') {
    const bankName = typeof body.bank_name === 'string' ? body.bank_name.trim() : '';
    const accountNumber = typeof body.bank_account_number === 'string' ? body.bank_account_number.trim() : '';
    const accountName = typeof body.bank_account_name === 'string' ? body.bank_account_name.trim() : '';

    if (!bankName) return jsonResponse(400, { success: false, error: 'bank_name is required' });
    if (!ACCOUNT_NUMBER_RE.test(accountNumber)) {
      return jsonResponse(400, { success: false, error: 'bank_account_number must be a 10-digit NUBAN account number' });
    }
    if (!accountName) return jsonResponse(400, { success: false, error: 'bank_account_name is required' });

    const { error } = await adminClient
      .from('riders')
      .update({
        pending_bank_name: bankName,
        pending_bank_account_number: accountNumber,
        pending_bank_account_name: accountName,
        pending_bank_requested_at: new Date().toISOString(),
      })
      .eq('id', rider.id);
    if (error) return jsonResponse(500, { success: false, error: 'Failed to submit change request' });

    return jsonResponse(200, {
      success: true,
      message: 'Payout details submitted for review. Your current account stays active until this is approved.',
    });
  }

  return jsonResponse(400, { success: false, error: "field must be one of: phone, vehicle, bank" });
}
