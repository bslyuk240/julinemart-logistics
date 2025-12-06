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
    console.log('Event path:', event.path);
    console.log('Query params:', event.queryStringParameters);

    // Extract order_id from path OR query parameter
    let orderId = null;
    
    // Method 1: From query parameter
    if (event.queryStringParameters && event.queryStringParameters.order_id) {
      orderId = event.queryStringParameters.order_id;
      console.log('Got order_id from query param:', orderId);
    }
    
    // Method 2: From path parameters
    if (!orderId && event.pathParameters && event.pathParameters.orderId) {
      orderId = event.pathParameters.orderId;
      console.log('Got order_id from path param:', orderId);
    }
    
    // Method 3: Parse from path manually
    if (!orderId) {
      const pathOnly = event.path.split('?')[0];
      const pathParts = pathOnly.split('/').filter(Boolean);
      
      // Find 'order' and get next part
      const orderIndex = pathParts.findIndex(part => part === 'order');
      if (orderIndex >= 0 && pathParts[orderIndex + 1]) {
        orderId = pathParts[orderIndex + 1];
        console.log('Got order_id from path parsing:', orderId);
      }
    }

    if (!orderId) {
      console.error('Could not extract order_id from path');
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ 
          success: false, 
          error: 'Order ID required',
          hint: 'Use: /api/return-shipments/order/{orderId}'
        }),
      };
    }

    console.log('Fetching returns for order_id:', orderId);

    // Query return_shipments with their parent return_requests
    // Join on return_requests to get order_id
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