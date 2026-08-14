/**
 * GET /api/customer-gift-order?order_id=<uuid>
 *
 * Customer gift timeline (Bearer token, order owner only).
 */
import { createClient } from '@supabase/supabase-js';
import { authenticateCustomer } from './services/customerAuth.js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || ''
);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

export const GIFT_STATUS_LABELS = {
  new: 'Order placed',
  paid: 'Payment confirmed',
  packing: 'Being packed with care',
  packed: 'Gift box ready',
  dispatch: 'On the way',
  delivered: 'Delivered',
};

export const GIFT_CUSTOMER_TIMELINE = ['paid', 'packing', 'packed', 'dispatch', 'delivered'];

async function assertOrderOwnedByEmail(orderId, email) {
  const { data: order } = await supabase
    .from('orders')
    .select('id, customer_email, order_kind')
    .eq('id', orderId)
    .maybeSingle();

  if (!order || order.customer_email?.toLowerCase() !== email) {
    return { error: 'Order not found' };
  }
  return { order };
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: 'Method not allowed' }),
    };
  }

  const { email, error: authError } = await authenticateCustomer(event);
  if (authError) {
    return {
      statusCode: 401,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: authError }),
    };
  }

  const orderId = event.queryStringParameters?.order_id;
  if (!orderId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: 'order_id required' }),
    };
  }

  const owned = await assertOrderOwnedByEmail(orderId, email);
  if (owned.error) {
    return {
      statusCode: 404,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: owned.error }),
    };
  }

  if (!['gift_ready_made', 'gift_custom'].includes(owned.order.order_kind)) {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ success: true, data: null }),
    };
  }

  const { data: giftOrder, error } = await supabase
    .from('gift_orders')
    .select(`
      id, gift_status, recipient_name, gift_message, sender_visible, occasion,
      packed_at, dispatched_at, completed_at, created_at,
      gift_boxes ( name, slug )
    `)
    .eq('order_id', orderId)
    .maybeSingle();

  if (error) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: error.message }),
    };
  }

  if (!giftOrder) {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ success: true, data: null }),
    };
  }

  const { data: events } = await supabase
    .from('gift_order_events')
    .select('status, note, created_at')
    .eq('gift_order_id', giftOrder.id)
    .order('created_at', { ascending: true });

  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({
      success: true,
      data: {
        ...giftOrder,
        events: events || [],
        timeline: GIFT_CUSTOMER_TIMELINE,
        status_labels: GIFT_STATUS_LABELS,
      },
    }),
  };
}
