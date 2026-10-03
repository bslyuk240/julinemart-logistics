// Netlify Function — Supabase-native refund management
// Replaces the legacy WooCommerce proxy

import { createClient } from '@supabase/supabase-js';
import { createPaystackRefund } from './services/returns-utils.js';
import { requireAdmin } from './services/global-sourcing-utils.js';
import { recordStaffAudit } from './services/auditLog.js';
import { RETURNS_ACTION_ROLES, RETURNS_VIEW_ROLES } from './services/staff-roles.js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || ''
);

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
};

const parsePath = (path) => {
  const parts = path.split('/').filter(Boolean);
  const idx = parts.findIndex((p) => p === 'refunds');
  const after = idx >= 0 ? parts.slice(idx + 1) : [];
  const section = after[0];
  const id = after.length > 1 ? after[1] : undefined;
  const action = after.length > 2 ? after[2] : undefined;
  return { section, id, action };
};

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // Staff only. This creates Paystack refunds for any order and edits refund
  // records, and had no login check at all. Reading the list is open to
  // read-only viewers; everything that changes a refund needs an action role.
  const auth = await requireAdmin(
    event,
    event.httpMethod === 'GET' ? RETURNS_VIEW_ROLES : RETURNS_ACTION_ROLES
  );
  if (auth.errorResponse) return auth.errorResponse;

  try {
    const { section, id, action } = parsePath(event.path);

    if (section !== 'requests') {
      return { statusCode: 404, headers, body: JSON.stringify({ success: false, error: 'Not found' }) };
    }

    // ── GET /api/refunds/requests — list all refund records ────────────────
    if (event.httpMethod === 'GET' && !id) {
      const { data, error } = await supabase
        .from('refund_records')
        .select(`
          *,
          orders ( id, order_number, customer_name, customer_email, total_amount ),
          return_requests ( id, reason_code, reason_note, preferred_resolution, status )
        `)
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: data || [] }) };
    }

    // ── PUT /api/refunds/requests/:id — update refund record status ────────
    if (event.httpMethod === 'PUT' && id) {
      const body = JSON.parse(event.body || '{}');
      const { status, notes } = body;

      const update = { updated_at: new Date().toISOString() };
      if (status) update.status = status;
      if (notes) update.reason = notes;

      const { data, error } = await supabase
        .from('refund_records')
        .update(update)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, data }) };
    }

    // ── POST /api/refunds/requests/:orderId/note — append to order notes ───
    if (event.httpMethod === 'POST' && id && action === 'note') {
      const body = JSON.parse(event.body || '{}');
      const { note } = body;
      if (!note) {
        return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Missing note' }) };
      }

      // Append note to orders.order_notes via JSONB metadata
      const { data: order, error: fetchErr } = await supabase
        .from('orders')
        .select('id, metadata')
        .eq('id', id)
        .maybeSingle();

      if (fetchErr || !order) {
        return { statusCode: 404, headers, body: JSON.stringify({ success: false, error: 'Order not found' }) };
      }

      const existingNotes = order.metadata?.admin_notes || [];
      const updatedNotes = [...existingNotes, { note, created_at: new Date().toISOString() }];

      await supabase
        .from('orders')
        .update({ metadata: { ...order.metadata, admin_notes: updatedNotes } })
        .eq('id', id);

      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    // ── POST /api/refunds/requests/:orderId/create-refund — Paystack refund ─
    if (event.httpMethod === 'POST' && id && action === 'create-refund') {
      const body = JSON.parse(event.body || '{}');
      const { amount, reason, return_request_id } = body;

      if (!amount || typeof Number(amount) !== 'number' || Number(amount) <= 0) {
        return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Valid amount is required' }) };
      }

      // Fetch the order to get payment_reference
      const { data: order, error: orderErr } = await supabase
        .from('orders')
        .select('id, order_number, payment_reference, payment_method, total_amount')
        .eq('id', id)
        .maybeSingle();

      if (orderErr || !order) {
        return { statusCode: 404, headers, body: JSON.stringify({ success: false, error: 'Order not found' }) };
      }

      if (!order.payment_reference) {
        return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'No payment reference on order — cannot process automatic refund' }) };
      }

      // Create Paystack refund
      const refundResult = await createPaystackRefund({
        transactionRef: order.payment_reference,
        amount: Number(amount),
        reason,
      });

      // Record in Supabase
      const { data: record, error: recErr } = await supabase
        .from('refund_records')
        .insert({
          order_id: order.id,
          return_request_id: return_request_id || null,
          amount: Number(amount),
          currency: 'NGN',
          reason,
          status: refundResult.status || 'pending',
          paystack_refund_id: String(refundResult.id || ''),
          paystack_transaction_ref: order.payment_reference,
          paystack_status: refundResult.status,
          paystack_raw: refundResult,
          initiated_by: 'admin',
          completed_at: refundResult.status === 'processed' ? new Date().toISOString() : null,
        })
        .select()
        .single();

      if (recErr) console.error('Failed to record refund:', recErr.message);

      await recordStaffAudit(event, auth.authUser, {
        action: 'REFUND_CREATED',
        resource_type: 'orders',
        resource_id: order.id,
        details: {
          amount: Number(amount),
          reason: reason || null,
          return_request_id: return_request_id || null,
          paystack_refund_id: refundResult?.id ? String(refundResult.id) : null,
        },
      });

      return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: record || refundResult }) };
    }

    return { statusCode: 404, headers, body: JSON.stringify({ success: false, error: 'Not found' }) };
  } catch (error) {
    console.error('Refunds function error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: error?.message || 'Server error' }) };
  }
}
