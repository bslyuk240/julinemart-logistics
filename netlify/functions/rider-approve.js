/**
 * rider-approve.js — Admin only. Approve or reject a rider KYC application.
 *
 * POST /api/rider-approve
 * Body: { rider_id, action: 'approve' | 'reject', reject_reason? }
 *
 * Unlike vendor-approve.js, there's no Supabase Auth account to create
 * here — the rider already has one (self-service sign-up happens before
 * the application, not after approval). This just flips status.
 */
import { requireAdmin, jsonResponse, headers } from './services/global-sourcing-utils.js';
import { recordStaffAudit } from './services/auditLog.js';

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return jsonResponse(405, { success: false, error: 'Method not allowed' });

  const auth = await requireAdmin(event, ['admin', 'manager']);
  if (auth.errorResponse) return auth.errorResponse;
  const { adminClient, authUser } = auth;

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return jsonResponse(400, { success: false, error: 'Invalid JSON' });
  }

  const { rider_id, action, reject_reason } = body;
  if (!rider_id || !action) {
    return jsonResponse(400, { success: false, error: 'rider_id and action required' });
  }
  if (!['approve', 'reject', 'suspend', 'reactivate'].includes(action)) {
    return jsonResponse(400, { success: false, error: 'action must be approve, reject, suspend, or reactivate' });
  }

  const { data: rider, error: riderErr } = await adminClient
    .from('riders')
    .select('id, full_name, email, status')
    .eq('id', rider_id)
    .maybeSingle();

  if (riderErr) return jsonResponse(500, { success: false, error: riderErr.message });
  if (!rider) return jsonResponse(404, { success: false, error: 'Rider not found' });

  if (['approve', 'reject'].includes(action) && rider.status !== 'pending_review') {
    return jsonResponse(409, { success: false, error: `Rider is already ${rider.status}` });
  }
  if (action === 'suspend' && rider.status !== 'active') {
    return jsonResponse(409, { success: false, error: `Only an active rider can be suspended (currently ${rider.status})` });
  }
  if (action === 'reactivate' && rider.status !== 'suspended') {
    return jsonResponse(409, { success: false, error: `Only a suspended rider can be reactivated (currently ${rider.status})` });
  }

  if (action === 'suspend') {
    const { error: updErr } = await adminClient
      .from('riders')
      .update({ status: 'suspended', reject_reason: reject_reason || null, updated_at: new Date().toISOString() })
      .eq('id', rider_id);
    if (updErr) return jsonResponse(500, { success: false, error: updErr.message });

    await recordStaffAudit(event, authUser, {
      action: 'RIDER_SUSPENDED',
      resource_type: 'riders',
      resource_id: rider_id,
      details: { full_name: rider.full_name, email: rider.email, reason: reject_reason || null },
    });

    return jsonResponse(200, { success: true, message: `${rider.full_name} suspended` });
  }

  if (action === 'reactivate') {
    const { error: updErr } = await adminClient
      .from('riders')
      .update({ status: 'active', reject_reason: null, updated_at: new Date().toISOString() })
      .eq('id', rider_id);
    if (updErr) return jsonResponse(500, { success: false, error: updErr.message });

    await recordStaffAudit(event, authUser, {
      action: 'RIDER_REACTIVATED',
      resource_type: 'riders',
      resource_id: rider_id,
      details: { full_name: rider.full_name, email: rider.email },
    });

    return jsonResponse(200, { success: true, message: `${rider.full_name} reactivated` });
  }

  if (action === 'reject') {
    const { error: updErr } = await adminClient
      .from('riders')
      .update({
        status: 'rejected',
        reject_reason: reject_reason || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', rider_id);

    if (updErr) return jsonResponse(500, { success: false, error: updErr.message });

    await recordStaffAudit(event, authUser, {
      action: 'RIDER_APPLICATION_REJECTED',
      resource_type: 'riders',
      resource_id: rider_id,
      details: { full_name: rider.full_name, email: rider.email, reject_reason: reject_reason || null },
    });

    return jsonResponse(200, { success: true, message: 'Application rejected' });
  }

  const { error: updErr } = await adminClient
    .from('riders')
    .update({
      status: 'active',
      approved_at: new Date().toISOString(),
      approved_by: authUser.id,
      reject_reason: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', rider_id);

  if (updErr) return jsonResponse(500, { success: false, error: updErr.message });

  await recordStaffAudit(event, authUser, {
    action: 'RIDER_APPLICATION_APPROVED',
    resource_type: 'riders',
    resource_id: rider_id,
    details: { full_name: rider.full_name, email: rider.email },
  });

  return jsonResponse(200, { success: true, message: `${rider.full_name} approved` });
}
