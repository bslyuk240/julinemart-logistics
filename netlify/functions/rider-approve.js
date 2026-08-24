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
import { sendRiderPush } from './services/riderNotifications.js';
import { sendRiderAccountEmail } from '../../shared/riderLifecycleEmail.js';

// Best-effort push+email to the rider after an account-lifecycle action.
// Never let notification failure block the action itself — the DB update
// already committed by the time this runs.
async function notifyRiderOfAction(adminClient, rider, riderId, { type, title, message, subject, headline, reason, targetPath }) {
  try {
    await sendRiderPush(adminClient, riderId, { type, title, message, data: { targetPath: targetPath || '/' } });
  } catch (err) {
    console.error('notifyRiderOfAction push failed:', err?.message || err);
  }
  if (rider?.email) {
    try {
      await sendRiderAccountEmail(adminClient, {
        to: rider.email,
        riderName: rider.full_name,
        subject,
        headline: headline || title,
        message,
        reason,
      });
    } catch (err) {
      console.error('notifyRiderOfAction email failed:', err?.message || err);
    }
  }
}

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

  const { rider_id, action, reject_reason, document_id, rejection_reason } = body;
  const ACTIONS = [
    'approve',
    'reject',
    'suspend',
    'reactivate',
    'approve_bank_change',
    'reject_bank_change',
    'approve_vehicle_change',
    'reject_vehicle_change',
    'verify_document',
    'reject_document',
    'delete',
  ];
  if (!action || !ACTIONS.includes(action)) {
    return jsonResponse(400, { success: false, error: `action must be one of: ${ACTIONS.join(', ')}` });
  }

  // Per-document review — a distinct object from the application-level
  // approve/reject above (see rider_documents, docs/rider-app-ux-rebuild.md
  // #17). Keyed by document_id, not rider_id, since a rider can have
  // several documents of the same type over time (resubmission history).
  if (action === 'verify_document' || action === 'reject_document') {
    if (!document_id) return jsonResponse(400, { success: false, error: 'document_id is required' });

    const { data: doc, error: docErr } = await adminClient
      .from('rider_documents')
      .select('id, rider_id, type, status, riders ( full_name, email )')
      .eq('id', document_id)
      .maybeSingle();
    if (docErr) return jsonResponse(500, { success: false, error: docErr.message });
    if (!doc) return jsonResponse(404, { success: false, error: 'Document not found' });

    const nextStatus = action === 'verify_document' ? 'verified' : 'rejected';
    const { error: updErr } = await adminClient
      .from('rider_documents')
      .update({
        status: nextStatus,
        verified_at: nextStatus === 'verified' ? new Date().toISOString() : null,
        verified_by: nextStatus === 'verified' ? authUser.id : null,
        rejection_reason: nextStatus === 'rejected' ? rejection_reason || null : null,
      })
      .eq('id', document_id);
    if (updErr) return jsonResponse(500, { success: false, error: updErr.message });

    await recordStaffAudit(event, authUser, {
      action: nextStatus === 'verified' ? 'RIDER_DOCUMENT_VERIFIED' : 'RIDER_DOCUMENT_REJECTED',
      resource_type: 'rider_documents',
      resource_id: document_id,
      details: { rider_id: doc.rider_id, type: doc.type, reason: rejection_reason || null },
    });

    const docLabel = String(doc.type || 'document').replace(/_/g, ' ');
    await notifyRiderOfAction(adminClient, doc.riders, doc.rider_id, {
      type: nextStatus === 'verified' ? 'rider_document_verified' : 'rider_document_rejected',
      title: nextStatus === 'verified' ? 'Document verified' : 'Document needs resubmission',
      message:
        nextStatus === 'verified'
          ? `Your ${docLabel} has been verified.`
          : `Your ${docLabel} was rejected and needs to be resubmitted.`,
      subject: nextStatus === 'verified' ? 'JulineMart Rider: Document verified' : 'JulineMart Rider: Document needs resubmission',
      reason: nextStatus === 'rejected' ? rejection_reason || null : null,
      targetPath: '/documents',
    });

    return jsonResponse(200, { success: true, message: `Document ${nextStatus}` });
  }

  if (!rider_id) {
    return jsonResponse(400, { success: false, error: 'rider_id is required' });
  }

  const { data: rider, error: riderErr } = await adminClient
    .from('riders')
    .select(
      'id, full_name, email, status, user_id, pending_bank_name, pending_bank_account_number, pending_bank_account_name, pending_vehicle_type, pending_vehicle_plate'
    )
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

  if (action === 'delete') {
    const ACTIVE_JOB_STATUSES = ['assigned', 'picked_up', 'out_for_delivery', 'return_required', 'returning'];
    const { data: activeJobs, error: jobErr } = await adminClient
      .from('shipments')
      .select('id, status, tracking_number')
      .eq('assigned_rider_id', rider_id)
      .in('status', ACTIVE_JOB_STATUSES)
      .limit(1);
    if (jobErr) return jsonResponse(500, { success: false, error: jobErr.message });
    if (activeJobs?.length) {
      const tracking = activeJobs[0].tracking_number || 'this delivery';
      return jsonResponse(409, {
        success: false,
        error: `This rider still has an in-progress job (${tracking}). Reassign or finish it before deleting.`,
      });
    }

    const { data: openWithdrawals, error: wdErr } = await adminClient
      .from('rider_withdrawals')
      .select('id')
      .eq('rider_id', rider_id)
      .in('status', ['pending', 'approved'])
      .limit(1);
    if (wdErr && !/does not exist|schema cache/i.test(wdErr.message || '')) {
      return jsonResponse(500, { success: false, error: wdErr.message });
    }
    if (!wdErr && openWithdrawals?.length) {
      return jsonResponse(409, {
        success: false,
        error: 'This rider has an outstanding withdrawal. Pay or reject it before deleting.',
      });
    }

    await adminClient.from('device_tokens').delete().eq('customer_id', rider_id);
    if (!wdErr) {
      await adminClient.from('rider_withdrawals').delete().eq('rider_id', rider_id);
    }

    const { error: delErr } = await adminClient.from('riders').delete().eq('id', rider_id);
    if (delErr) return jsonResponse(500, { success: false, error: delErr.message });

    if (rider.user_id) {
      const { error: authErr } = await adminClient.auth.admin.deleteUser(rider.user_id);
      if (authErr) {
        console.warn('rider-approve delete: auth user cleanup failed:', authErr.message);
      }
    }

    await recordStaffAudit(event, authUser, {
      action: 'RIDER_DELETED',
      resource_type: 'riders',
      resource_id: rider_id,
      details: { full_name: rider.full_name, email: rider.email },
    });

    return jsonResponse(200, { success: true, message: `${rider.full_name} deleted` });
  }
  if (['approve_bank_change', 'reject_bank_change'].includes(action) && !rider.pending_bank_name) {
    return jsonResponse(409, { success: false, error: 'This rider has no pending bank-detail change' });
  }
  if (['approve_vehicle_change', 'reject_vehicle_change'].includes(action) && !rider.pending_vehicle_type) {
    return jsonResponse(409, { success: false, error: 'This rider has no pending vehicle change' });
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

    await notifyRiderOfAction(adminClient, rider, rider_id, {
      type: 'rider_suspended',
      title: 'Account suspended',
      message: 'Your rider account has been suspended. You will not receive new deliveries until it is reactivated.',
      subject: 'JulineMart Rider: Account suspended',
      reason: reject_reason || null,
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

    await notifyRiderOfAction(adminClient, rider, rider_id, {
      type: 'rider_reactivated',
      title: 'Account reactivated',
      message: 'Your rider account has been reactivated. You can go online and receive deliveries again.',
      subject: 'JulineMart Rider: Account reactivated',
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

    await notifyRiderOfAction(adminClient, rider, rider_id, {
      type: 'rider_application_rejected',
      title: 'Application not approved',
      message: 'Your rider application was not approved this time.',
      subject: 'JulineMart Rider: Application update',
      reason: reject_reason || null,
    });

    return jsonResponse(200, { success: true, message: 'Application rejected' });
  }

  if (action === 'approve_bank_change') {
    const { error: updErr } = await adminClient
      .from('riders')
      .update({
        bank_name: rider.pending_bank_name,
        bank_account_number: rider.pending_bank_account_number,
        bank_account_name: rider.pending_bank_account_name,
        pending_bank_name: null,
        pending_bank_account_number: null,
        pending_bank_account_name: null,
        pending_bank_requested_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', rider_id);
    if (updErr) return jsonResponse(500, { success: false, error: updErr.message });

    await recordStaffAudit(event, authUser, {
      action: 'RIDER_BANK_CHANGE_APPROVED',
      resource_type: 'riders',
      resource_id: rider_id,
      details: { full_name: rider.full_name, email: rider.email, bank_name: rider.pending_bank_name },
    });

    await notifyRiderOfAction(adminClient, rider, rider_id, {
      type: 'rider_bank_change_approved',
      title: 'Payout account updated',
      message: 'Your new bank details have been approved and are now active for payouts.',
      subject: 'JulineMart Rider: Payout account updated',
      targetPath: '/profile',
    });

    return jsonResponse(200, { success: true, message: `Payout account updated for ${rider.full_name}` });
  }

  if (action === 'reject_bank_change') {
    const { error: updErr } = await adminClient
      .from('riders')
      .update({
        pending_bank_name: null,
        pending_bank_account_number: null,
        pending_bank_account_name: null,
        pending_bank_requested_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', rider_id);
    if (updErr) return jsonResponse(500, { success: false, error: updErr.message });

    await recordStaffAudit(event, authUser, {
      action: 'RIDER_BANK_CHANGE_REJECTED',
      resource_type: 'riders',
      resource_id: rider_id,
      details: { full_name: rider.full_name, email: rider.email, reason: reject_reason || null },
    });

    await notifyRiderOfAction(adminClient, rider, rider_id, {
      type: 'rider_bank_change_rejected',
      title: 'Bank change request rejected',
      message: 'Your requested bank detail change was not approved.',
      subject: 'JulineMart Rider: Bank change not approved',
      reason: reject_reason || null,
      targetPath: '/profile',
    });

    return jsonResponse(200, { success: true, message: 'Bank change request rejected' });
  }

  if (action === 'approve_vehicle_change') {
    const { error: updErr } = await adminClient
      .from('riders')
      .update({
        vehicle_type: rider.pending_vehicle_type,
        vehicle_plate: rider.pending_vehicle_plate,
        pending_vehicle_type: null,
        pending_vehicle_plate: null,
        pending_vehicle_requested_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', rider_id);
    if (updErr) return jsonResponse(500, { success: false, error: updErr.message });

    await recordStaffAudit(event, authUser, {
      action: 'RIDER_VEHICLE_CHANGE_APPROVED',
      resource_type: 'riders',
      resource_id: rider_id,
      details: { full_name: rider.full_name, email: rider.email, vehicle_type: rider.pending_vehicle_type, vehicle_plate: rider.pending_vehicle_plate },
    });

    await notifyRiderOfAction(adminClient, rider, rider_id, {
      type: 'rider_vehicle_change_approved',
      title: 'Vehicle details updated',
      message: 'Your new vehicle details have been approved and are now active on your profile.',
      subject: 'JulineMart Rider: Vehicle details updated',
      targetPath: '/profile',
    });

    return jsonResponse(200, { success: true, message: `Vehicle details updated for ${rider.full_name}` });
  }

  if (action === 'reject_vehicle_change') {
    const { error: updErr } = await adminClient
      .from('riders')
      .update({
        pending_vehicle_type: null,
        pending_vehicle_plate: null,
        pending_vehicle_requested_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', rider_id);
    if (updErr) return jsonResponse(500, { success: false, error: updErr.message });

    await recordStaffAudit(event, authUser, {
      action: 'RIDER_VEHICLE_CHANGE_REJECTED',
      resource_type: 'riders',
      resource_id: rider_id,
      details: { full_name: rider.full_name, email: rider.email, reason: reject_reason || null },
    });

    await notifyRiderOfAction(adminClient, rider, rider_id, {
      type: 'rider_vehicle_change_rejected',
      title: 'Vehicle change request rejected',
      message: 'Your requested vehicle detail change was not approved.',
      subject: 'JulineMart Rider: Vehicle change not approved',
      reason: reject_reason || null,
      targetPath: '/profile',
    });

    return jsonResponse(200, { success: true, message: 'Vehicle change request rejected' });
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

  await notifyRiderOfAction(adminClient, rider, rider_id, {
    type: 'rider_application_approved',
    title: 'Application approved',
    message: "You're approved! Go online in the app to start receiving deliveries.",
    subject: 'JulineMart Rider: Application approved',
  });

  return jsonResponse(200, { success: true, message: `${rider.full_name} approved` });
}
