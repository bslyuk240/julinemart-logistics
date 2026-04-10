/**
 * GET  /api/vendor-withdrawals        — list vendor's withdrawal requests
 * POST /api/vendor-withdrawals        — submit new withdrawal request
 *
 * Admin actions (JLO staff):
 * PUT  /api/vendor-withdrawals/:id    — approve | reject | mark paid
 *   Body: { action: 'approve'|'reject'|'paid', payment_reference?, rejection_reason?, notes? }
 */
import { corsHeaders, preflightResponse } from './services/cors.js';
import { authenticateVendor, getAdminClient } from './services/vendorAuth.js';
import { requireAdmin } from './services/global-sourcing-utils.js';

// Extract :id from path  /api/vendor-withdrawals/uuid
function extractId(path) {
  const parts = (path || '').split('/');
  const idx = parts.findIndex(p => p === 'vendor-withdrawals');
  return idx >= 0 && parts[idx + 1] ? parts[idx + 1] : null;
}

export async function handler(event) {
  const origin = event.headers?.origin || event.headers?.Origin || '';
  if (event.httpMethod === 'OPTIONS') return preflightResponse(origin);

  const id = extractId(event.path);

  // ── PUT — admin only, skip vendor auth ───────────────────────────────────
  if (event.httpMethod === 'PUT' && id) {
    const adminAuth = await requireAdmin(event, ['admin', 'manager', 'staff']);
    if (adminAuth.errorResponse) return adminAuth.errorResponse;

    const body = event.body ? JSON.parse(event.body) : {};
    const { action, payment_reference, rejection_reason, notes, payment_date } = body;

    let updates = { updated_at: new Date().toISOString() };

    if (action === 'approve') {
      updates.status = 'approved';
    } else if (action === 'reject') {
      if (!rejection_reason) return { statusCode: 400, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: 'rejection_reason required' }) };
      updates = { ...updates, status: 'rejected', rejection_reason };
    } else if (action === 'paid') {
      updates = { ...updates, status: 'paid', payment_reference: payment_reference || null, payment_date: payment_date || new Date().toISOString(), notes: notes || null };
    } else {
      return { statusCode: 400, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: 'action must be approve | reject | paid' }) };
    }

    const { data, error: updErr } = await getAdminClient().from('vendor_withdrawals').update(updates).eq('id', id).select().single();
    if (updErr) return { statusCode: 500, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: updErr.message }) };
    return { statusCode: 200, headers: corsHeaders(origin), body: JSON.stringify({ success: true, data }) };
  }

  // GET / POST — vendor auth required
  const { vendor, adminClient, error } = await authenticateVendor(event);
  if (error) return { statusCode: 401, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error }) };

  // ── GET list ─────────────────────────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    const { data, error: qErr } = await adminClient
      .from('vendor_withdrawals')
      .select('*')
      .eq('vendor_id', vendor.id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (qErr) return { statusCode: 500, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: qErr.message }) };
    return { statusCode: 200, headers: corsHeaders(origin), body: JSON.stringify({ success: true, data }) };
  }

  // ── POST — vendor requests withdrawal ───────────────────────────────────
  if (event.httpMethod === 'POST') {
    const body = event.body ? JSON.parse(event.body) : {};
    const amount = Number(body.amount);
    if (!amount || amount <= 0) return { statusCode: 400, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: 'amount is required and must be > 0' }) };

    // Check available balance
    const { data: summary } = await adminClient
      .from('vendor_earnings_summary')
      .select('available_balance')
      .eq('vendor_id', vendor.id)
      .single();

    const available = Number(summary?.available_balance || 0);
    if (amount > available) {
      return {
        statusCode: 400,
        headers: corsHeaders(origin),
        body: JSON.stringify({ success: false, error: `Insufficient balance. Available: ₦${available.toLocaleString()}` }),
      };
    }

    const { data, error: insErr } = await adminClient
      .from('vendor_withdrawals')
      .insert({
        vendor_id:            vendor.id,
        amount,
        bank_name:            body.bank_name || vendor.bank_name,
        bank_account_number:  body.bank_account_number || vendor.bank_account_number,
        bank_account_name:    body.bank_account_name || vendor.bank_account_name,
        notes:                body.notes || null,
        status:               'pending',
      })
      .select()
      .single();

    if (insErr) return { statusCode: 500, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: insErr.message }) };
    return { statusCode: 201, headers: corsHeaders(origin), body: JSON.stringify({ success: true, data }) };
  }

  return { statusCode: 405, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
}
