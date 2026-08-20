/**
 * rider-profile-update.js — a rider requests a change to their own payout
 * bank details.
 *
 * POST /api/rider-profile-update
 * Body: { bank_name, bank_account_number, bank_account_name }
 *
 * This does NOT change riders.bank_name/bank_account_number/bank_account_name
 * — those stay whatever they were at approval and are what rider-withdrawals
 * pays out to. The request lands in pending_bank_* instead, and only takes
 * effect once staff approves it (rider-approve.js, action
 * approve_bank_change) — a payout destination is exactly the kind of field
 * an account-takeover would target, so unlike a phone number this can't be
 * an instant self-edit. See docs/rider-commission-design.md §10.
 */
import { requireActiveRider, jsonResponse, headers } from './services/requireRider.js';
import { checkRateLimit } from './services/rate-limit.js';

const ACCOUNT_NUMBER_RE = /^\d{10}$/;

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

  if (error) {
    console.error('rider-profile-update error:', error);
    return jsonResponse(500, { success: false, error: 'Failed to submit change request' });
  }

  return jsonResponse(200, {
    success: true,
    message: 'Payout details submitted for review. Your current account stays active until this is approved.',
  });
}
