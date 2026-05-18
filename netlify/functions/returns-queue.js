// Returns queue — full lifecycle view for admin dashboard
// Replaces refund-queue.js
import { createClient } from '@supabase/supabase-js';
import { corsHeaders, preflightResponse } from './services/cors.js';

const adminClient = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

const ALL_STATUSES = [
  'pending_review',
  'approved',
  'awaiting_dropoff',
  'in_transit',
  'delivered_to_hub',
  'inspection_in_progress',
  'vendor_approved',
  'refund_processing',
  'refund_completed',
  'refund_failed',
  'rejected',
  // legacy statuses
  'awaiting_tracking',
  'pickup_scheduled',
  'completed',
];

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return preflightResponse();
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
  }

  try {
    const url = new URL(event.rawUrl);
    const statusFilter = url.searchParams.get('status'); // comma-separated or 'all'
    const search = url.searchParams.get('search') || '';
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
    const limit = Math.min(50, parseInt(url.searchParams.get('limit') || '25', 10));
    const offset = (page - 1) * limit;

    // Determine which statuses to include
    let statuses;
    if (!statusFilter || statusFilter === 'all') {
      statuses = ALL_STATUSES;
    } else {
      statuses = statusFilter.split(',').map(s => s.trim()).filter(Boolean);
    }

    let query = adminClient
      .from('return_requests')
      .select(`
        id,
        order_id,
        supabase_order_id,
        order_number,
        customer_name,
        customer_email,
        status,
        reason_code,
        reason_note,
        images,
        refund_amount,
        refund_status,
        refund_method,
        paystack_refund_id,
        refund_completed_at,
        refund_currency,
        rejection_reason,
        inspection_result,
        inspection_notes,
        inspected_at,
        hub_id,
        created_at,
        updated_at,
        return_shipments (
          id,
          return_code,
          fez_tracking,
          fez_shipment_id,
          status,
          method,
          destination_type,
          destination_address,
          vendor_id,
          label_url,
          customer_submitted_tracking,
          created_at
        )
      `, { count: 'exact' })
      .in('status', statuses)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (search) {
      query = query.or(`order_number.ilike.%${search}%,customer_email.ilike.%${search}%,customer_name.ilike.%${search}%`);
    }

    const { data: requests, error, count } = await query;
    if (error) throw error;

    // Enrich with order payment info
    const orderIds = [...new Set(
      (requests || [])
        .map(r => r.supabase_order_id)
        .filter(Boolean)
    )];

    let orderMap = {};
    if (orderIds.length > 0) {
      const { data: orders } = await adminClient
        .from('orders')
        .select('id, order_number, total_amount, payment_method, payment_reference, customer_name, customer_email, customer_phone, delivery_address, delivery_state, delivery_city')
        .in('id', orderIds);

      for (const o of (orders || [])) {
        orderMap[o.id] = o;
      }
    }

    const enriched = (requests || []).map(r => {
      const order = orderMap[r.supabase_order_id] || null;
      const isPaystack = !!(
        order?.payment_reference?.startsWith('JLO-') ||
        order?.payment_method?.toLowerCase().includes('paystack') ||
        order?.payment_method?.toLowerCase().includes('card')
      );

      return {
        ...r,
        order_payment: order ? {
          order_number: order.order_number,
          total_amount: order.total_amount,
          payment_method: order.payment_method,
          payment_reference: order.payment_reference,
          customer_name: order.customer_name,
          customer_email: order.customer_email,
          customer_phone: order.customer_phone,
          delivery_address: order.delivery_address,
          delivery_state: order.delivery_state,
          delivery_city: order.delivery_city,
          is_paystack: isPaystack,
        } : null,
      };
    });

    // Stats counts across all statuses (not filtered)
    const { data: allStatuses } = await adminClient
      .from('return_requests')
      .select('status');

    const stats = {
      pending_review: 0,
      approved: 0,
      in_transit: 0,
      delivered_to_hub: 0,
      vendor_approved: 0,
      refund_completed: 0,
      rejected: 0,
      refund_failed: 0,
    };
    for (const row of (allStatuses || [])) {
      if (row.status in stats) stats[row.status]++;
    }

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({
        success: true,
        data: enriched,
        total: count || 0,
        page,
        limit,
        stats,
      }),
    };

  } catch (error) {
    console.error('returns-queue error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ success: false, error: error.message }),
    };
  }
}
