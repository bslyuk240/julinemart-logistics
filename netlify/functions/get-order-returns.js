// GET /api/return-shipments/order/:orderId - Fetch all returns for an order (JLO Dashboard)
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
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: 'Method not allowed - use GET' }),
    };
  }

  try {
    console.log('=== GET RETURNS FOR ORDER ===');
    console.log('Query params:', event.queryStringParameters);

    // Extract orderId from query parameter (dashboard uses ?orderId=XXX)
    const orderId = event.queryStringParameters?.orderId || event.queryStringParameters?.order_id;

    if (!orderId) {
      console.error('Missing orderId parameter');
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ 
          success: false, 
          error: 'Order ID required',
          hint: 'Use: /get-order-returns?orderId={orderId}'
        }),
      };
    }

    console.log('Fetching returns for order_id:', orderId);

    // Query return_shipments joined with their parent return_requests
    const { data: shipments, error: queryError } = await supabase
      .from('return_shipments')
      .select(`
        *,
        return_request:return_requests!inner(
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
      .eq('return_request.order_id', orderId)
      .order('created_at', { ascending: false });

    if (queryError) {
      console.error('Database query error:', queryError);
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          error: 'Failed to fetch returns: ' + queryError.message,
        }),
      };
    }

    console.log(`Found ${shipments?.length || 0} returns for order ${orderId}`);

    // Return empty array if no returns (not an error)
    if (!shipments || shipments.length === 0) {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          data: [],
          message: 'No returns found for this order',
        }),
      };
    }

    // Transform data for frontend
    const transformedData = shipments.map(shipment => ({
      // Shipment data
      id: shipment.id,
      return_code: shipment.return_code,
      fez_tracking: shipment.fez_tracking,
      fez_shipment_id: shipment.fez_shipment_id,
      method: shipment.method,
      status: shipment.status,
      customer_submitted_tracking: shipment.customer_submitted_tracking,
      tracking_submitted_at: shipment.tracking_submitted_at,
      created_at: shipment.created_at,
      updated_at: shipment.updated_at,
      
      // Return request data (nested)
      return_request: shipment.return_request,
    }));

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        data: transformedData,
        count: transformedData.length,
      }),
    };
  } catch (error) {
    console.error('Unexpected error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        success: false,
        error: 'Internal server error: ' + error.message,
      }),
    };
  }
}