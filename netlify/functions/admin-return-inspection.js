// Admin inspection + refund trigger
import { supabase, createWooRefund } from './services/returns-utils.js';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: 'Method not allowed' }) };

  const parts = event.path.split('/');
  const idx = parts.findIndex((p) => p === 'returns');
  const returnId = idx >= 0 ? parts[idx + 1] : null;
  if (!returnId) return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Missing return id' }) };

  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const { status, inspection_result, inspection_notes, approved_refund_amount } = body;
    if (!status || !['approved', 'rejected'].includes(status)) {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'status must be approved or rejected' }) };
    }

    const { data: request, error: fetchErr } = await supabase
      .from('return_requests')
      .select('*')
      .eq('id', returnId)
      .single();
    if (fetchErr || !request) throw fetchErr || new Error('Return request not found');

    if (!['delivered_to_hub', 'inspection_in_progress', 'pickup_scheduled', 'in_transit'].includes(request.status)) {
      // allow forward progress only
      console.warn('Inspection called in unexpected status:', request.status);
    }

    let nextStatus = status === 'approved' ? 'refund_processing' : 'rejected';
    let refundPayload = null;

    if (status === 'approved' && request.preferred_resolution === 'refund' && approved_refund_amount) {
      try {
        const reason = `Return approved (Return ID: ${request.id}; Reason: ${request.reason_code || ''})`;
        const wooRefund = await createWooRefund(request.order_id, approved_refund_amount, reason);
        refundPayload = wooRefund;
        nextStatus = 'refund_completed';
        await supabase
          .from('return_requests')
          .update({
            refund_status: 'completed',
            refund_amount: approved_refund_amount,
            refund_currency: wooRefund.currency || 'NGN',
            refund_method: 'original_payment',
            refund_wc_id: wooRefund.id || wooRefund.refund_id || null,
            refund_raw: wooRefund,
            refund_completed_at: new Date().toISOString(),
          })
          .eq('id', returnId);
      } catch (err) {
        nextStatus = 'refund_failed';
        await supabase
          .from('return_requests')
          .update({
            refund_status: 'failed',
            refund_raw: { error: err.message },
          })
          .eq('id', returnId);
        return { statusCode: 502, headers, body: JSON.stringify({ success: false, error: err.message || 'Refund failed' }) };
      }
    }

    await supabase
      .from('return_requests')
      .update({
        status: nextStatus,
        inspection_result,
        inspection_notes,
        inspected_at: new Date().toISOString(),
      })
      .eq('id', returnId);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        data: { status: nextStatus, refund: refundPayload || null },
      }),
    };
  } catch (error) {
    console.error('admin-return-inspection error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: error.message || 'Internal error' }) };
  }
}
