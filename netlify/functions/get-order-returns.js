// GET /api/return-shipments/order/:orderId
// Fetch all return shipments for an order.
// Accepts either:
//   ?order_id=<supabase-uuid>  — direct UUID lookup (preferred, Supabase-native)
//   ?orderId=<wc-number>       — legacy WooCommerce order number (resolved to UUID)

import { createClient } from '@supabase/supabase-js';
import { authenticateCustomer } from './services/customerAuth.js';
import { returnSelect, formatReturnForCustomer } from './services/return-format.js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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

  // Requires the customer's login, and only returns that customer's own order.
  const { email, error: authError } = await authenticateCustomer(event);
  if (authError) {
    return {
      statusCode: 401,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: 'Sign in required' }),
    };
  }

  try {
    console.log('=== GET ORDER RETURNS ===');

    // Prefer direct Supabase UUID; fall back to legacy WC order number
    const directUUID = event.queryStringParameters?.order_id;
    const legacyOrderNumber =
      event.queryStringParameters?.orderId ||
      event.queryStringParameters?.order_number;

    if (!directUUID && !legacyOrderNumber) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          error: 'order_id (Supabase UUID) or orderId is required',
        }),
      };
    }

    // Resolve the order, from a Supabase UUID or a legacy WC order number, and
    // check it belongs to the signed-in caller. "Not found" and "not yours" get
    // the same empty answer so order ids can't be probed.
    let orderQuery = supabase.from('orders').select('id, customer_email');
    orderQuery = directUUID
      ? orderQuery.eq('id', directUUID)
      : orderQuery.eq('woocommerce_order_id', legacyOrderNumber);
    const { data: order, error: orderError } = await orderQuery.maybeSingle();

    const owned =
      !orderError &&
      order &&
      String(order.customer_email || '').trim().toLowerCase() === email;
    if (!owned) {
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

    // --------------------------------------------------
    // 2. Fetch this order's returns
    // --------------------------------------------------
    // Returns the same customer-facing shape as returns-list (the PWA's
    // JloReturn: return_request_id, status, refund info, pickup details...).
    // This used to return bare shipment rows with the request nested inside,
    // and it filtered a numeric column by a UUID, so it never matched; the
    // storefront quietly fell back to returns-list. Now it works directly and
    // both agree. return_requests.order_id is the legacy numeric WooCommerce
    // id, so match on supabase_order_id.
    const { data: requests, error: requestsError } = await supabase
      .from('return_requests')
      .select(await returnSelect(supabase))
      .eq('supabase_order_id', orderUUID)
      .order('created_at', { ascending: false });

    if (requestsError) {
      console.error('❌ Failed to fetch returns:', requestsError);

      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          error: 'Failed to fetch returns',
        }),
      };
    }

    const returns = (requests || []).map(formatReturnForCustomer);
    console.log(`📦 Found ${returns.length} return(s)`);

    // --------------------------------------------------
    // 3. Always return a safe array
    // --------------------------------------------------
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        data: returns,
        count: returns.length,
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
