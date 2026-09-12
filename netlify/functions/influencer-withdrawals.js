/**
 * GET  /api/influencer-withdrawals        — list the authenticated influencer's own withdrawal requests
 * POST /api/influencer-withdrawals        — influencer requests a new withdrawal
 *
 * Admin actions (JLO staff):
 * PUT  /api/influencer-withdrawals/:id    — approve | reject | mark paid
 *   Body: { action: 'approve'|'reject'|'paid', payment_reference?, rejection_reason?, payment_date? }
 *
 * Mirrors rider-withdrawals.js's shape (rate-limited requests, ledger write on
 * paid), trimmed of push/email notifications since neither has an influencer
 * equivalent yet. Available balance is computed here rather than from a
 * dedicated view (influencers.total_commission_earned/total_commission_paid
 * are already the running totals used everywhere else in this codebase),
 * explicitly netting out open (pending/approved) withdrawal requests so an
 * influencer can't request more than once against the same balance.
 */
import { corsHeaders, preflightResponse } from './services/cors.js';
import { authenticateInfluencer } from './services/influencerAuth.js';
import { requireAdmin } from './services/global-sourcing-utils.js';
import { checkRateLimit } from './services/rate-limit.js';
import { recordAudit, recordStaffAudit, requestMeta } from './services/auditLog.js';

function extractId(path) {
  const parts = (path || '').split('/');
  const idx = parts.findIndex((p) => p === 'influencer-withdrawals');
  return idx >= 0 && parts[idx + 1] ? parts[idx + 1] : null;
}

async function computeAvailableBalance(adminClient, influencer) {
  const { data: openWithdrawals } = await adminClient
    .from('influencer_withdrawals')
    .select('amount')
    .eq('influencer_id', influencer.id)
    .in('status', ['pending', 'approved']);

  const openTotal = (openWithdrawals || []).reduce((sum, w) => sum + Number(w.amount || 0), 0);
  const earned = Number(influencer.total_commission_earned || 0);
  const paid = Number(influencer.total_commission_paid || 0);
  return Math.max(0, earned - paid - openTotal);
}

export async function handler(event) {
  const origin = event.headers?.origin || event.headers?.Origin || '';
  if (event.httpMethod === 'OPTIONS') return preflightResponse(origin);

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
      return { statusCode: 400, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: 'Invalid JSON' }) };
    }
    const { action, payment_reference, rejection_reason, payment_date } = body;

    const { data: withdrawal, error: lookupErr } = await adminClient
      .from('influencer_withdrawals')
      .select('id, influencer_id, amount, status, influencer:influencers ( name, email )')
      .eq('id', id)
      .maybeSingle();
    if (lookupErr) return { statusCode: 500, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: lookupErr.message }) };
    if (!withdrawal) return { statusCode: 404, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: 'Withdrawal not found' }) };

    let updates = { updated_at: new Date().toISOString(), reviewed_by: authUser.id, reviewed_at: new Date().toISOString() };

    if (action === 'approve') {
      if (withdrawal.status !== 'pending') {
        return { statusCode: 409, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: `Already ${withdrawal.status}` }) };
      }
      updates.status = 'approved';
    } else if (action === 'reject') {
      if (withdrawal.status !== 'pending') {
        return { statusCode: 409, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: `Already ${withdrawal.status}` }) };
      }
      if (!rejection_reason) {
        return { statusCode: 400, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: 'rejection_reason required' }) };
      }
      updates = { ...updates, status: 'rejected', rejection_reason };
    } else if (action === 'paid') {
      if (!['pending', 'approved'].includes(withdrawal.status)) {
        return { statusCode: 409, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: `Already ${withdrawal.status}` }) };
      }
      updates = {
        ...updates,
        status: 'paid',
        payment_reference: payment_reference || null,
        payment_date: payment_date || new Date().toISOString(),
      };
    } else {
      return { statusCode: 400, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: 'action must be approve | reject | paid' }) };
    }

    const { data, error: updErr } = await adminClient.from('influencer_withdrawals').update(updates).eq('id', id).select().single();
    if (updErr) return { statusCode: 500, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: updErr.message }) };

    if (action === 'paid') {
      // Keep influencers.total_commission_paid as the single running total —
      // the portal Dashboard and this same balance calc both read it.
      const { data: current } = await adminClient
        .from('influencers')
        .select('total_commission_paid')
        .eq('id', withdrawal.influencer_id)
        .maybeSingle();
      await adminClient
        .from('influencers')
        .update({ total_commission_paid: Number(current?.total_commission_paid || 0) + Number(withdrawal.amount || 0) })
        .eq('id', withdrawal.influencer_id);

      try {
        await adminClient.from('ledger_expenses').insert({
          source: 'automatic',
          source_reference: id,
          category: 'marketing',
          subcategory: 'influencer_commission',
          amount: withdrawal.amount,
          currency: 'NGN',
          tax_deductible: true,
          vat_amount: 0,
          payment_method: 'bank_transfer',
          payment_reference: payment_reference || null,
          paid_to: withdrawal.influencer?.name || 'Influencer',
          paid_at: updates.payment_date,
          description: `Influencer payout — ${withdrawal.influencer?.name || 'Influencer'} withdrawal ${id.slice(0, 8)}`,
          metadata: { influencer_withdrawal_id: id, influencer_id: withdrawal.influencer_id },
          created_at: new Date().toISOString(),
        });
      } catch (ledgerErr) {
        console.error('influencer-withdrawals ledger_expenses insert failed:', ledgerErr);
      }
    }

    const actionMap = { approve: 'INFLUENCER_WITHDRAWAL_APPROVED', reject: 'INFLUENCER_WITHDRAWAL_REJECTED', paid: 'INFLUENCER_WITHDRAWAL_PAID' };
    await recordStaffAudit(event, authUser, {
      action: actionMap[action] || 'INFLUENCER_WITHDRAWAL_UPDATED',
      resource_type: 'influencer_withdrawals',
      resource_id: id,
      details: { action, amount: data?.amount, influencer_id: data?.influencer_id },
    });

    return { statusCode: 200, headers: corsHeaders(origin), body: JSON.stringify({ success: true, data }) };
  }

  // ── GET / POST — influencer auth required ──────────────────────────────
  const { influencer, userId, adminClient, error } = await authenticateInfluencer(event);
  if (error) return { statusCode: 401, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error }) };

  if (event.httpMethod === 'GET') {
    const { data, error: listErr } = await adminClient
      .from('influencer_withdrawals')
      .select('*')
      .eq('influencer_id', influencer.id)
      .order('created_at', { ascending: false })
      .limit(50);
    if (listErr) return { statusCode: 500, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: listErr.message }) };

    const available_balance = await computeAvailableBalance(adminClient, influencer);
    return { statusCode: 200, headers: corsHeaders(origin), body: JSON.stringify({ success: true, data, available_balance }) };
  }

  if (event.httpMethod === 'POST') {
    const { limited, response } = await checkRateLimit(event, {
      name: 'influencer-withdrawals-request',
      max: 5,
      window: '10 m',
      retryAfterSeconds: 600,
    });
    if (limited) return response;

    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return { statusCode: 400, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: 'Invalid JSON' }) };
    }
    const amount = Number(body.amount);
    if (!amount || amount <= 0) {
      return { statusCode: 400, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: 'amount is required and must be > 0' }) };
    }

    if (!influencer.account_number) {
      return {
        statusCode: 400,
        headers: corsHeaders(origin),
        body: JSON.stringify({ success: false, error: 'Add your payout bank details in Profile before requesting a withdrawal.' }),
      };
    }

    const available = await computeAvailableBalance(adminClient, influencer);
    if (amount > available) {
      return {
        statusCode: 400,
        headers: corsHeaders(origin),
        body: JSON.stringify({ success: false, error: `Insufficient balance. Available: ₦${available.toLocaleString()}` }),
      };
    }

    const { data, error: insErr } = await adminClient
      .from('influencer_withdrawals')
      .insert({
        influencer_id: influencer.id,
        amount,
        bank_name: influencer.bank_name,
        account_number: influencer.account_number,
        account_name: influencer.account_name,
        notes: body.notes || null,
        status: 'pending',
      })
      .select()
      .single();
    if (insErr) return { statusCode: 500, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: insErr.message }) };

    await recordAudit({
      action: 'INFLUENCER_WITHDRAWAL_REQUESTED',
      resource_type: 'influencer_withdrawals',
      resource_id: data?.id,
      user_id: userId,
      actor_email: influencer.email,
      source: 'influencer_portal',
      details: { amount, influencer_id: influencer.id, name: influencer.name },
      ...requestMeta(event),
    });

    return { statusCode: 201, headers: corsHeaders(origin), body: JSON.stringify({ success: true, data }) };
  }

  return { statusCode: 405, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
}
