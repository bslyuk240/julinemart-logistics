// GET /api/returns/:id/tracking - Fetch tracking status (FIXED VERSION)
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
      body: JSON.stringify({ success: false, error: 'Method not allowed' }),
    };
  }

  try {
    console.log('=== GET RETURN TRACKING ===');
    console.log('Event path:', event.path);
    console.log('Query params:', event.queryStringParameters);

    // Extract return_request_id from query parameters OR path
    let returnRequestId = null;
    
    // Method 1: From query parameter (easiest)
    if (event.queryStringParameters && event.queryStringParameters.return_request_id) {
      returnRequestId = event.queryStringParameters.return_request_id;
      console.log('Got ID from query param:', returnRequestId);
    }
    
    // Method 2: From path parameters (Netlify routing)
    if (!returnRequestId && event.pathParameters && event.pathParameters.id) {
      returnRequestId = event.pathParameters.id;
      console.log('Got ID from path param:', returnRequestId);
    }
    
    // Method 3: Parse from path manually
    if (!returnRequestId) {
      const pathOnly = event.path.split('?')[0];
      const pathParts = pathOnly.split('/').filter(Boolean);
      const returnsIndex = pathParts.findIndex(part => part === 'returns');
      if (returnsIndex >= 0 && pathParts[returnsIndex + 1]) {
        returnRequestId = pathParts[returnsIndex + 1];
        console.log('Got ID from path parsing:', returnRequestId);
      }
    }

    if (!returnRequestId || returnRequestId === 'tracking') {
      console.error('Could not extract return_request_id from path');
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ 
          success: false, 
          message: 'Return ID required in path',
          details: { 
            path: event.path,
            hint: 'Use: /api/returns/{return_request_id}/tracking'
          }
        }),
      };
    }

    console.log('Querying shipment for return_request_id:', returnRequestId);

    // Fetch return shipment by return_request_id
    const { data: shipment, error: dbError } = await supabase
      .from('return_shipments')
      .select('*')
      .eq('return_request_id', returnRequestId)
      .maybeSingle(); // Use maybeSingle instead of single to avoid error if not found

    console.log('Database result:', { 
      found: !!shipment, 
      error: dbError?.message,
      shipment_id: shipment?.id 
    });

    if (dbError) {
      console.error('Database error:', dbError);
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          message: 'Failed to fetch tracking',
          details: { message: dbError.message }
        }),
      };
    }

    if (!shipment) {
      console.warn('No shipment found for return_request_id:', returnRequestId);
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          message: 'Return shipment not found',
          details: { 
            return_request_id: returnRequestId,
            hint: 'This return may not have a shipment yet'
          }
        }),
      };
    }

    // If no tracking number yet
    if (!shipment.fez_tracking) {
      console.log('Shipment found but no tracking number yet');
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          data: {
            return_code: shipment.return_code,
            shipment_id: shipment.id,
            tracking_number: null,
            status: shipment.status || 'awaiting_tracking',
            events: [],
            message: 'Awaiting customer to submit tracking number',
          },
        }),
      };
    }

    // Has tracking number - return info
    console.log('Shipment found with tracking:', shipment.fez_tracking);
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        data: {
          return_code: shipment.return_code,
          shipment_id: shipment.id,
          tracking_number: shipment.fez_tracking,
          status: shipment.status,
          submitted_at: shipment.tracking_submitted_at,
          events: [
            {
              status: 'Tracking number submitted',
              date: shipment.tracking_submitted_at,
              location: 'Customer',
            },
          ],
        },
      }),
    };
  } catch (error) {
    console.error('Unexpected error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        success: false,
        message: 'Failed to fetch tracking',
        details: { message: error.message }
      }),
    };
  }
}