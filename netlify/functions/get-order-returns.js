// GET /api/return-shipments/order/:orderId
// Fetch all return shipments for a WooCommerce order (Dashboard-safe)

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

export async function handler(event) {
  // ----------------------------
  // CORS PREFLIGHT
  // ----------------------------
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({
        success: false,
        error: 'Method not allowed. Use GET.',
      }),
    };
  }

  try {
    console.log('=== GET ORDER RETURNS ===');

    const orderNumber =
      event.queryStringParameters?.orderId ||
      event.queryStringParameters?.order_number;

    if (!orderNumber) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          error: 'orderId (Woo order number) is required',
        }),
      };
    }

    console.log('🔎 Resolving Woo order number:', orderNumber);

    // --------------------------------------------------
    // 1. Resolve Woo order number → Supabase order UUID
    // --------------------------------------------------
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id')
      .eq('woocommerce_order_id', orderNumber)
      .single();

    if (orderError || !order) {
      console.warn('⚠️ Order not found in Supabase:', orderNumber);

      // IMPORTANT: Not an error — just no returns yet
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          data: [],
          message: 'Order not found or no returns yet',
        }),
      };
    }

    const orderUUID = order.id;
    console.log('✅ Order UUID resolved:', orderUUID);

    // --------------------------------------------------
    // 2. Fetch return shipments using UUID
    // --------------------------------------------------
    const { data: shipments, error: shipmentsError } = await supabase
      .from('return_shipments')
      .select(`
        id,
        return_code,
        fez_tracking,
        fez_shipment_id,
        method,
        status,
        customer_submitted_tracking,
        tracking_submitted_at,
        created_at,
        updated_at,
        return_request:return_requests (
          id,
          order_id,
          order_number,
          customer_name,
          customer_email,
          preferred_resolution,
          reason_code,
          reason_note,
          images,
          status,
          hub_id,
          created_at,
          updated_at
        )
      `)
      .eq('return_request.order_id', orderUUID)
      .order('created_at', { ascending: false });

    if (shipmentsError) {
      console.error('❌ Failed to fetch return shipments:', shipmentsError);

      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          error: 'Failed to fetch return shipments',
        }),
      };
    }

    console.log(`📦 Found ${shipments?.length || 0} return shipment(s)`);

    // --------------------------------------------------
    // 3. Always return a safe array
    // --------------------------------------------------
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        data: shipments || [],
        count: shipments?.length || 0,
      }),
    };
  } catch (error) {
    console.error('❌ Unexpected error:', error);

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        success: false,
        error: 'Internal server error',
        message: error.message,
      }),
    };
  }
}
