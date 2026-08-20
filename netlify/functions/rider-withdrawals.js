/**
 * GET  /api/rider-withdrawals        — list the authenticated rider's withdrawal requests
 * POST /api/rider-withdrawals        — rider requests a new withdrawal
 *
 * Admin actions (JLO staff):
 * PUT  /api/rider-withdrawals/:id    — approve | reject | mark paid
 *   Body: { action: 'approve'|'reject'|'paid', payment_reference?, rejection_reason?, notes? }
 *
 * Mirrors vendor-withdrawals.js's shape — see
 * docs/rider-commission-design.md §9b for why this exists instead of the
 * older, generic per-sub-order settlement path in settlements.js (that
 * path pays the full customer fee with no record of which rider was paid;
 * this one is bounded by rider_earnings_summary.available_balance, which
 * reads shipments.rider_payout — the commission-adjusted amount).
 */
import { requireActiveRider, jsonResponse, headers } from './services/requireRider.js';
import { requireAdmin } from './services/global-sourcing-utils.js';
import { checkRateLimit } from './services/rate-limit.js';
import { recordAudit, recordStaffAudit, requestMeta } from './services/auditLog.js';

function extractId(path) {
  const parts = (path || '').split('/');
  const idx = parts.findIndex((p) => p === 'rider-withdrawals');
  return idx >= 0 && parts[idx + 1] ? parts[idx + 1] : null;
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const id = extractId(event.path);

  // ── PUT — admin only ──────────────────────────────────────────────────
  if (event.httpMethod === 'PUT' && id) {
    const adminAuth = await requireAdmin(event, ['admin', 'manager', 'staff']);
    if (adminAuth.errorResponse) return adminAuth.errorResponse;
    const { adminClient, authUser } = adminAuth;

    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return jsonResponse(400, { success: false, error: 'Invalid JSON' });
    }
    const { action, payment_reference, rejection_reason, notes, payment_date } = body;

    const { data: withdrawal, error: lookupErr } = await adminClient
      .from('rider_withdrawals')
      .select('id, rider_id, amount, status, riders ( full_name )')
      .eq('id', id)
      .maybeSingle();
    if (lookupErr) return jsonResponse(500, { success: false, error: lookupErr.message });
    if (!withdrawal) return jsonResponse(404, { success: false, error: 'Withdrawal not found' });

    let updates = { updated_at: new Date().toISOString(), reviewed_by: authUser.id, reviewed_at: new Date().toISOString() };

    if (action === 'approve') {
      if (withdrawal.status !== 'pending') return jsonResponse(409, { success: false, error: `Already ${withdrawal.status}` });
      updates.status = 'approved';
    } else if (action === 'reject') {
      if (withdrawal.status !== 'pending') return jsonResponse(409, { success: false, error: `Already ${withdrawal.status}` });
      if (!rejection_reason) return jsonResponse(400, { success: false, error: 'rejection_reason required' });
      updates = { ...updates, status: 'rejected', notes: rejection_reason };
    } else if (action === 'paid') {
      if (!['pending', 'approved'].includes(withdrawal.status)) {
        return jsonResponse(409, { success: false, error: `Already ${withdrawal.status}` });
      }
      updates = {
        ...updates,
        status: 'paid',
        payment_reference: payment_reference || null,
        payment_date: payment_date || new Date().toISOString(),
        notes: notes || null,
      };
    } else {
      return jsonResponse(400, { success: false, error: 'action must be approve | reject | paid' });
    }

    const { data, error: updErr } = await adminClient.from('rider_withdrawals').update(updates).eq('id', id).select().single();
    if (updErr) return jsonResponse(500, { success: false, error: updErr.message });

    if (action === 'paid') {
      // Same ledger mechanism settlements.js already uses for the generic
      // per-sub-order case — monthly_pnl_view nets this against revenue
      // automatically, no view changes needed.
      try {
        await adminClient.from('ledger_expenses').insert({
          source: 'rider_withdrawal',
          source_reference: id,
          category: 'courier',
          subcategory: 'delivery_fees',
          amount: withdrawal.amount,
          currency: 'NGN',
          tax_deductible: true,
          vat_amount: 0,
          payment_method: 'bank_transfer',
          payment_reference: payment_reference || null,
          paid_to: withdrawal.riders?.full_name || 'Rider',
          paid_at: updates.payment_date,
          description: `Rider payout — ${withdrawal.riders?.full_name || 'Rider'} withdrawal ${id.slice(0, 8)}`,
          metadata: { rider_withdrawal_id: id, rider_id: withdrawal.rider_id },
          created_at: new Date().toISOString(),
        });
      } catch (ledgerErr) {
        console.error('rider-withdrawals ledger_expenses insert failed:', ledgerErr);
      }
    }

    const actionMap = { approve: 'RIDER_WITHDRAWAL_APPROVED', reject: 'RIDER_WITHDRAWAL_REJECTED', paid: 'RIDER_WITHDRAWAL_PAID' };
    await recordStaffAudit(event, authUser, {
      action: actionMap[action] || 'RIDER_WITHDRAWAL_UPDATED',
      resource_type: 'rider_withdrawals',
      resource_id: id,
      details: { action, amount: data?.amount, rider_id: data?.rider_id },
    });

    return jsonResponse(200, { success: true, data });
  }

  // ── GET / POST — rider auth required ────────────────────────────────────
  const session = await requireActiveRider(event);
  if (session.errorResponse) return session.errorResponse;
  const { rider, adminClient } = session;

  if (event.httpMethod === 'GET') {
    const { data, error } = await adminClient
      .from('rider_withdrawals')
      .select('*')
      .eq('rider_id', rider.id)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) return jsonResponse(500, { success: false, error: error.message });
    return jsonResponse(200, { success: true, data });
  }

  if (event.httpMethod === 'POST') {
    const { limited, response } = await checkRateLimit(event, {
      name: 'rider-withdrawals-request',
      max: 5,
      window: '10 m',
      retryAfterSeconds: 600,
    });
    if (limited) return response;

    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return jsonResponse(400, { success: false, error: 'Invalid JSON' });
    }
    const amount = Number(body.amount);
    if (!amount || amount <= 0) return jsonResponse(400, { success: false, error: 'amount is required and must be > 0' });

    if (!rider.bank_account_number) {
      return jsonResponse(400, {
        success: false,
        error: 'Add your payout account details in Profile before requesting a withdrawal.',
      });
    }

    const { data: summary } = await adminClient
      .from('rider_earnings_summary')
      .select('available_balance')
      .eq('rider_id', rider.id)
      .maybeSingle();

    const available = Number(summary?.available_balance || 0);
    if (amount > available) {
      return jsonResponse(400, { success: false, error: `Insufficient balance. Available: ₦${available.toLocaleString()}` });
    }

    const { data, error: insErr } = await adminClient
      .from('rider_withdrawals')
      .insert({
        rider_id: rider.id,
        amount,
        bank_name: rider.bank_name,
        bank_account_number: rider.bank_account_number,
        bank_account_name: rider.bank_account_name,
        notes: body.notes || null,
        status: 'pending',
      })
      .select()
      .single();
    if (insErr) return jsonResponse(500, { success: false, error: insErr.message });

    await recordAudit({
      action: 'RIDER_WITHDRAWAL_REQUESTED',
      resource_type: 'rider_withdrawals',
      resource_id: data?.id,
      user_id: rider.user_id,
      actor_email: rider.email,
      source: 'rider_app',
      details: { amount, rider_id: rider.id, full_name: rider.full_name },
      ...requestMeta(event),
    });

    return jsonResponse(201, { success: true, data });
  }

  return jsonResponse(405, { success: false, error: 'Method not allowed' });
}
