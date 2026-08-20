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
 *   bank_name, bank_account_number, bank_account_name,
 * }
 *
 * Upserts on user_id: first submission creates the row (status →
 * pending_review); resubmitting after a rejection resets it to
 * pending_review for re-review rather than leaving it stuck rejected.
 */
import { verifySession, jsonResponse, headers } from './services/requireRider.js';
import { checkRateLimit } from './services/rate-limit.js';
import { sendPushToAllStaff } from './services/pushNotifications.js';
import { sendStaffAlertEmails } from '../../shared/riderLifecycleEmail.js';

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
  'bank_name',
  'bank_account_number',
  'bank_account_name',
];

// Nigerian NUBAN account numbers are 10 digits — catches an obvious typo
// (transposed digit, pasted phone number) before it reaches an admin
// reviewing dozens of applications, without hard-coding a bank list.
const ACCOUNT_NUMBER_RE = /^\d{10}$/;

const VEHICLE_TYPES = ['okada', 'keke', 'car', 'foot'];

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return jsonResponse(405, { success: false, error: 'Method not allowed' });

  const { limited, response } = await checkRateLimit(event, {
    name: 'rider-register',
    max: 5,
    window: '10 m',
    retryAfterSeconds: 600,
  });
  if (limited) return response;

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
  if (!ACCOUNT_NUMBER_RE.test(String(body.bank_account_number).trim())) {
    return jsonResponse(400, { success: false, error: 'bank_account_number must be a 10-digit NUBAN account number' });
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
    bank_name: String(body.bank_name).trim(),
    bank_account_number: String(body.bank_account_number).trim(),
    bank_account_name: String(body.bank_account_name).trim(),
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

  // Per-document lifecycle tracking (docs/rider-app-ux-rebuild.md #17) —
  // a new row per submission, not an update-in-place, so a resubmission
  // after rejection keeps the old row as history instead of overwriting
  // it. Best-effort: a failure here shouldn't block the application
  // itself, which already succeeded above.
  try {
    const docs = [
      {
        rider_id: rider.id,
        type: 'id',
        file_url: body.id_document_url,
        issue_date: body.id_document_issue_date || null,
        expiry_date: body.id_document_expiry_date || null,
      },
      { rider_id: rider.id, type: 'selfie', file_url: body.selfie_url },
    ];
    if (body.vehicle_document_url) {
      docs.push({
        rider_id: rider.id,
        type: 'vehicle',
        file_url: body.vehicle_document_url,
        issue_date: body.vehicle_document_issue_date || null,
        expiry_date: body.vehicle_document_expiry_date || null,
      });
    }
    await adminClient.from('rider_documents').insert(docs);
  } catch (docErr) {
    console.error('rider-register rider_documents insert failed:', docErr);
  }

  // Staff need to know a new application landed so they actually go review
  // it — nothing else surfaces this (rider-approve.js's list is pull-only).
  try {
    const adminBaseUrl = process.env.URL || process.env.JLO_BASE_URL || '';
    await sendPushToAllStaff({
      title: 'New rider application',
      message: `${row.full_name} applied to become a rider.`,
      type: 'rider_application_submitted',
      data: { targetPath: '/rider-verifications' },
    });
    await sendStaffAlertEmails(adminClient, {
      subject: 'JulineMart: New rider application',
      headline: 'New rider application submitted',
      message: `${row.full_name} (${row.phone}) applied to become a rider and is awaiting review.`,
      actionUrl: adminBaseUrl ? `${adminBaseUrl}/rider-verifications` : undefined,
      actionLabel: 'Review application',
    });
  } catch (notifyErr) {
    console.error('rider-register staff notify failed:', notifyErr);
  }

  return jsonResponse(201, {
    success: true,
    data: { rider_id: rider.id, status: rider.status },
    message: 'Application submitted. We’ll review your documents and call your guarantor — usually within 24–48 hours.',
  });
}
