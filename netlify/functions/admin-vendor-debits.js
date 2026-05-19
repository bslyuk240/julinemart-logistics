/**
 * Admin endpoint for managing vendor return debits (earnings owed back after a return).
 *
 * GET  /api/admin/vendor-debits          — list all debits (with vendor + return info)
 * POST /api/admin/vendor-debits          — actions: send-payment-link | mark-paid | waive
 *
 * Actions (body.action):
 *   send-payment-link  — initialises a Paystack transaction and emails vendor the link
 *   mark-paid          — admin manually marks a bank-transfer debit as paid_back
 *   waive              — admin waives the debit (write-off)
 */

import { requireAdmin, adminClient, jsonResponse, headers } from './services/global-sourcing-utils.js';
import { sendTransactionalEmail } from './services/emailNotifications.js';
import crypto from 'crypto';

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
const SITE_BASE = process.env.SITE_URL || process.env.URL || 'https://julinemart.com';

async function paystackPost(path, body) {
  const res = await fetch(`https://api.paystack.co${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${PAYSTACK_SECRET}`,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok || !json.status) throw new Error(json.message || `Paystack error ${res.status}`);
  return json.data;
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const auth = await requireAdmin(event, ['admin', 'manager']);
  if (auth.errorResponse) return auth.errorResponse;

  // ── GET — list all debits ──────────────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    const qs = event.queryStringParameters || {};
    let query = adminClient
      .from('vendor_return_debits')
      .select(`
        id, amount, status, recovery_method, notes,
        paystack_payment_link, paystack_reference,
        created_at, updated_at,
        vendors ( id, store_name, email ),
        return_requests ( id, order_id, status,
          orders ( order_number )
        )
      `)
      .order('created_at', { ascending: false });

    if (qs.status) query = query.eq('status', qs.status);
    if (qs.vendor_id) query = query.eq('vendor_id', qs.vendor_id);

    const { data, error } = await query;
    if (error) return jsonResponse(500, { success: false, error: error.message });
    return jsonResponse(200, { success: true, data });
  }

  // ── POST — actions ─────────────────────────────────────────────────────────
  if (event.httpMethod === 'POST') {
    const body = event.body ? JSON.parse(event.body) : {};
    const { action, debit_id, notes, payment_reference } = body;

    if (!debit_id) return jsonResponse(400, { success: false, error: 'debit_id required' });

    // Fetch the debit + vendor info
    const { data: debit, error: fetchErr } = await adminClient
      .from('vendor_return_debits')
      .select(`
        id, vendor_id, amount, status, recovery_method,
        return_request_id,
        vendors ( id, store_name, email ),
        return_requests ( id, order_id,
          orders ( order_number )
        )
      `)
      .eq('id', debit_id)
      .single();

    if (fetchErr || !debit) return jsonResponse(404, { success: false, error: 'Debit not found' });
    if (debit.status !== 'pending') {
      return jsonResponse(400, { success: false, error: `Debit is already ${debit.status}` });
    }

    // ── send-payment-link ────────────────────────────────────────────────────
    if (action === 'send-payment-link') {
      if (!PAYSTACK_SECRET) return jsonResponse(503, { success: false, error: 'Paystack not configured' });

      const vendorEmail = debit.vendors?.email;
      if (!vendorEmail) return jsonResponse(400, { success: false, error: 'Vendor has no email' });

      // Unique reference: vrd-<debit_id_short>-<timestamp>
      const ref = `vrd-${debit.id.slice(0, 8)}-${Date.now()}`;
      const amountKobo = Math.round(Number(debit.amount) * 100);
      const orderNumber = debit.return_requests?.orders?.order_number || debit.return_requests?.order_id;

      const txData = await paystackPost('/transaction/initialize', {
        email: vendorEmail,
        amount: amountKobo,
        reference: ref,
        callback_url: `${SITE_BASE}/vendor-debit-paid`,
        metadata: {
          type: 'vendor_return_debit',
          debit_id: debit.id,
          vendor_id: debit.vendor_id,
          return_request_id: debit.return_request_id,
        },
      });

      const { data: updated, error: updateErr } = await adminClient
        .from('vendor_return_debits')
        .update({
          recovery_method: 'paystack',
          paystack_payment_link: txData.authorization_url,
          paystack_reference: ref,
          notes: notes || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', debit_id)
        .select()
        .single();

      if (updateErr) return jsonResponse(500, { success: false, error: updateErr.message });

      // Email vendor
      sendTransactionalEmail({
        templateName: 'Vendor Return Debit Payment Link',
        to: vendorEmail,
        data: {
          storeName: debit.vendors?.store_name || 'Vendor',
          orderNumber,
          amount: Number(debit.amount).toLocaleString('en-NG', { style: 'currency', currency: 'NGN' }),
          paymentLink: txData.authorization_url,
          notes: notes || '',
        },
      });

      return jsonResponse(200, { success: true, data: updated });
    }

    // ── mark-paid (bank transfer) ────────────────────────────────────────────
    if (action === 'mark-paid') {
      const { data: updated, error: updateErr } = await adminClient
        .from('vendor_return_debits')
        .update({
          status: 'paid_back',
          recovery_method: 'bank_transfer',
          notes: notes || null,
          ...(payment_reference ? { paystack_reference: payment_reference } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq('id', debit_id)
        .select()
        .single();

      if (updateErr) return jsonResponse(500, { success: false, error: updateErr.message });
      return jsonResponse(200, { success: true, data: updated });
    }

    // ── waive ────────────────────────────────────────────────────────────────
    if (action === 'waive') {
      const { data: updated, error: updateErr } = await adminClient
        .from('vendor_return_debits')
        .update({
          status: 'waived',
          recovery_method: 'waived',
          notes: notes || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', debit_id)
        .select()
        .single();

      if (updateErr) return jsonResponse(500, { success: false, error: updateErr.message });
      return jsonResponse(200, { success: true, data: updated });
    }

    return jsonResponse(400, { success: false, error: 'action must be send-payment-link | mark-paid | waive' });
  }

  return jsonResponse(405, { success: false, error: 'Method not allowed' });
}
