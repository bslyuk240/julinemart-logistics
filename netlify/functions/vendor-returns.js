/**
 * GET  /api/vendor-returns         — list return shipments assigned to this vendor
 * POST /api/vendor-returns         — confirm receipt OR inspect (approve/reject)
 *   action: 'confirm-receipt'  body: { shipment_id }
 *   action: 'inspect'          body: { return_request_id, decision: 'approve'|'reject', inspection_notes?, rejection_reason? }
 *
 * Vendor inspects the return; admin then triggers the actual Paystack refund.
 */
import { corsHeaders, preflightResponse } from './services/cors.js';
import { authenticateVendor } from './services/vendorAuth.js';
import { sendTransactionalEmail } from './services/emailNotifications.js';

export async function handler(event) {
  const origin = event.headers?.origin || event.headers?.Origin || '';
  if (event.httpMethod === 'OPTIONS') return preflightResponse(origin);

  const { vendor, adminClient, error } = await authenticateVendor(event);
  if (error) return { statusCode: 401, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error }) };

  // ── GET: returns assigned to this vendor ────────────────────────────────────
  if (event.httpMethod === 'GET') {
    const qs     = event.queryStringParameters || {};
    const page   = Math.max(1, parseInt(qs.page  || '1',  10));
    const limit  = Math.min(50, parseInt(qs.limit || '20', 10));
    const offset = (page - 1) * limit;

    const { data: shipments, error: qErr, count } = await adminClient
      .from('return_shipments')
      .select(`
        id,
        return_code,
        fez_tracking,
        status,
        method,
        destination_type,
        destination_address,
        created_at,
        return_requests!inner (
          id,
          order_number,
          customer_name,
          status,
          reason_code,
          reason_note,
          images,
          inspection_result,
          inspection_notes,
          rejection_reason,
          created_at,
          supabase_order_id
        )
      `, { count: 'exact' })
      .eq('vendor_id', vendor.id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (qErr) return { statusCode: 500, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: qErr.message }) };

    return {
      statusCode: 200,
      headers: corsHeaders(origin),
      body: JSON.stringify({ success: true, data: shipments || [], total: count || 0, page, limit }),
    };
  }

  // ── POST: confirm receipt or inspect ────────────────────────────────────────
  if (event.httpMethod === 'POST') {
    const body = event.body ? JSON.parse(event.body) : {};
    const { action } = body;

    if (!action || !['confirm-receipt', 'inspect'].includes(action)) {
      return { statusCode: 400, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: "action must be 'confirm-receipt' or 'inspect'" }) };
    }

    // ── CONFIRM RECEIPT ──────────────────────────────────────────────────────
    if (action === 'confirm-receipt') {
      const { shipment_id } = body;
      if (!shipment_id) return { statusCode: 400, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: 'shipment_id required' }) };

      const { data: shipment } = await adminClient
        .from('return_shipments')
        .select('id, return_request_id, status')
        .eq('id', shipment_id)
        .eq('vendor_id', vendor.id)
        .single();

      if (!shipment) return { statusCode: 404, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: 'Shipment not found or not assigned to your store' }) };

      if (['vendor_approved', 'refund_completed', 'rejected'].includes(shipment.status)) {
        return { statusCode: 400, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: `Cannot confirm receipt — shipment is already ${shipment.status}` }) };
      }

      await Promise.all([
        adminClient.from('return_shipments').update({ status: 'delivered_to_hub' }).eq('id', shipment_id),
        adminClient.from('return_requests').update({ status: 'delivered_to_hub' }).eq('id', shipment.return_request_id),
      ]);

      // Alert admin
      try {
        const [{ data: req }, { data: emailCfg }] = await Promise.all([
          adminClient.from('return_requests').select('order_number, customer_name').eq('id', shipment.return_request_id).single(),
          adminClient.from('email_config').select('order_alert_emails').single(),
        ]);
        const alertEmails = Array.isArray(emailCfg?.order_alert_emails) ? emailCfg.order_alert_emails.filter(Boolean) : [];
        for (const to of alertEmails) {
          sendTransactionalEmail({
            templateName: 'Return Delivered to Hub',
            to,
            data: {
              customerName: req?.customer_name || 'Customer',
              orderNumber:  req?.order_number  || shipment.return_request_id,
              storeName:    vendor.store_name,
            },
          });
        }
      } catch (err) {
        console.warn('confirm-receipt admin alert failed:', err.message);
      }

      return { statusCode: 200, headers: corsHeaders(origin), body: JSON.stringify({ success: true, data: { status: 'delivered_to_hub' } }) };
    }

    // ── INSPECT (vendor approves or rejects) ─────────────────────────────────
    if (action === 'inspect') {
      const { return_request_id, decision, inspection_notes, rejection_reason } = body;

      if (!return_request_id || !['approve', 'reject'].includes(decision)) {
        return { statusCode: 400, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: "return_request_id and decision ('approve'|'reject') are required" }) };
      }

      // Verify a shipment to this vendor exists for this return
      const { data: shipment } = await adminClient
        .from('return_shipments')
        .select('id, status')
        .eq('return_request_id', return_request_id)
        .eq('vendor_id', vendor.id)
        .single();

      if (!shipment) return { statusCode: 404, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: 'Return not found or not assigned to your store' }) };

      if (['vendor_approved', 'refund_completed', 'rejected', 'refund_failed'].includes(shipment.status)) {
        return { statusCode: 400, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: `Return is already ${shipment.status}` }) };
      }

      const { data: req } = await adminClient
        .from('return_requests')
        .select('id, order_number, customer_name, customer_email, supabase_order_id')
        .eq('id', return_request_id)
        .single();

      if (!req) return { statusCode: 404, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: 'Return request not found' }) };

      const nextStatus = decision === 'approve' ? 'vendor_approved' : 'rejected';

      await Promise.all([
        adminClient.from('return_requests').update({
          status:           nextStatus,
          inspection_result: decision,
          inspection_notes:  inspection_notes || null,
          inspected_at:      new Date().toISOString(),
          ...(decision === 'reject' ? { rejection_reason: rejection_reason || null } : {}),
        }).eq('id', return_request_id),
        adminClient.from('return_shipments').update({ status: nextStatus }).eq('id', shipment.id),
      ]);

      // Alert admin
      try {
        const { data: emailCfg } = await adminClient.from('email_config').select('order_alert_emails').single();
        const alertEmails = Array.isArray(emailCfg?.order_alert_emails) ? emailCfg.order_alert_emails.filter(Boolean) : [];
        const tpl = decision === 'approve' ? 'Return Vendor Approved' : 'Return Rejected';
        for (const to of alertEmails) {
          sendTransactionalEmail({
            templateName: tpl,
            to,
            orderId: req.supabase_order_id || null,
            data: {
              customerName:    req.customer_name || 'Customer',
              orderNumber:     req.order_number  || return_request_id,
              storeName:       vendor.store_name,
              inspectionNotes: inspection_notes  || '',
              rejectionReason: rejection_reason  || '',
            },
          });
        }
      } catch (err) {
        console.warn('inspect admin alert failed:', err.message);
      }

      // Notify customer if rejected
      if (decision === 'reject' && req.customer_email) {
        sendTransactionalEmail({
          templateName: 'Return Rejected',
          to:           req.customer_email,
          orderId:      req.supabase_order_id || null,
          data: {
            customerName:    req.customer_name || 'Customer',
            orderNumber:     req.order_number  || return_request_id,
            rejectionReason: rejection_reason  || '',
          },
        });
      }

      return {
        statusCode: 200,
        headers: corsHeaders(origin),
        body: JSON.stringify({ success: true, data: { status: nextStatus } }),
      };
    }
  }

  return { statusCode: 405, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
}
