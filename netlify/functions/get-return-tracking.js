// GET /api/returns/:id/tracking - Fetch tracking status
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
    // Extract return_request_id from path: /api/returns/:id/tracking
    const pathParts = event.path.split('/').filter(Boolean);
    const returnsIndex = pathParts.indexOf('returns');
    const returnRequestId = returnsIndex >= 0 ? pathParts[returnsIndex + 1] : null;

    if (!returnRequestId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: 'Return ID required' }),
      };
    }

    console.log('Fetching tracking for return_request_id:', returnRequestId);

    // Fetch return shipment by return_request_id
    const { data: shipment, error } = await supabase
      .from('return_shipments')
      .select('*')
      .eq('return_request_id', returnRequestId)
      .single();

    if (error || !shipment) {
      console.error('Shipment not found:', error);
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          error: 'Return shipment not found',
        }),
      };
    }

    // If no tracking number yet
    if (!shipment.fez_tracking) {
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

    // Has tracking number - return basic info
    // TODO: Call Fez API for real tracking events when needed
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
    console.error('Error fetching tracking:', error);
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