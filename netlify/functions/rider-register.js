/**
 * rider-register.js — authenticated, but does NOT require an existing
 * riders row (that's the point — a rider creates their Supabase Auth
 * account first via self-service sign-up, then submits this to create it).
 *
 * POST /api/rider-register
 * Body: {
 *   full_name, phone, nin,
 *   id_document_url,
 *   selfie_url,
 *   vehicle_type, vehicle_plate, vehicle_document_url,
 *   guarantor_name, guarantor_phone,
 *   approved_location_id,
 * }
 *
 * Upserts on user_id: first submission creates the row (status →
 * pending_review); resubmitting after a rejection resets it to
 * pending_review for re-review rather than leaving it stuck rejected.
 */
import { verifySession, jsonResponse, headers } from './services/requireRider.js';

const REQUIRED_FIELDS = [
  'full_name',
  'phone',
  'nin',
  'id_document_url',
  'selfie_url',
  'vehicle_type',
  'vehicle_plate',
  'guarantor_name',
  'guarantor_phone',
  'approved_location_id',
];

const VEHICLE_TYPES = ['okada', 'keke', 'car', 'foot'];

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return jsonResponse(405, { success: false, error: 'Method not allowed' });

  const session = await verifySession(event);
  if (session.errorResponse) return session.errorResponse;
  const { authUser, adminClient } = session;

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return jsonResponse(400, { success: false, error: 'Invalid JSON' });
  }

  for (const field of REQUIRED_FIELDS) {
    if (!body[field] || !String(body[field]).trim()) {
      return jsonResponse(400, { success: false, error: `Missing field: ${field}` });
    }
  }
  if (!VEHICLE_TYPES.includes(body.vehicle_type)) {
    return jsonResponse(400, { success: false, error: `vehicle_type must be one of: ${VEHICLE_TYPES.join(', ')}` });
  }

  // Verify the location is still active (same race-condition guard as vendor-register.js)
  const { data: location, error: locationError } = await adminClient
    .from('approved_vendor_locations')
    .select('id, status')
    .eq('id', body.approved_location_id)
    .eq('status', 'active')
    .maybeSingle();

  if (locationError || !location) {
    return jsonResponse(400, {
      success: false,
      error: 'The selected location is no longer accepting rider applications.',
    });
  }

  const { data: existing } = await adminClient
    .from('riders')
    .select('id, status')
    .eq('user_id', authUser.id)
    .maybeSingle();

  if (existing && existing.status === 'active') {
    return jsonResponse(409, { success: false, error: 'You already have an approved rider account.' });
  }
  if (existing && existing.status === 'pending_review') {
    return jsonResponse(409, { success: false, error: 'Your application is already under review.' });
  }

  const row = {
    user_id: authUser.id,
    full_name: String(body.full_name).trim(),
    email: authUser.email,
    phone: String(body.phone).trim(),
    nin: String(body.nin).trim(),
    id_document_url: body.id_document_url,
    selfie_url: body.selfie_url,
    selfie_captured_at: new Date().toISOString(),
    vehicle_type: body.vehicle_type,
    vehicle_plate: String(body.vehicle_plate).trim().toUpperCase(),
    vehicle_document_url: body.vehicle_document_url || null,
    guarantor_name: String(body.guarantor_name).trim(),
    guarantor_phone: String(body.guarantor_phone).trim(),
    approved_location_id: body.approved_location_id,
    status: 'pending_review',
    reject_reason: null,
    approved_at: null,
    approved_by: null,
  };

  const { data: rider, error } = await adminClient
    .from('riders')
    .upsert(row, { onConflict: 'user_id' })
    .select('id, status')
    .single();

  if (error) {
    console.error('rider-register upsert error:', error);
    return jsonResponse(500, { success: false, error: 'Failed to submit application' });
  }

  return jsonResponse(201, {
    success: true,
    data: { rider_id: rider.id, status: rider.status },
    message: 'Application submitted. We’ll review your documents and call your guarantor — usually within 24–48 hours.',
  });
}
