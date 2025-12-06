// POST /api/return-shipments/:id/tracking - Save customer tracking number (FIXED)
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

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: 'Method not allowed - use POST' }),
    };
  }

  try {
    console.log('=== ADD RETURN TRACKING ===');
    console.log('Event path:', event.path);
    console.log('Query params:', event.queryStringParameters);
    console.log('Body:', event.body);

    // Extract return_shipment_id from query parameters OR path
    let returnShipmentId = null;
    
    // Method 1: From query parameter (easiest)
    if (event.queryStringParameters && event.queryStringParameters.return_shipment_id) {
      returnShipmentId = event.queryStringParameters.return_shipment_id;
      console.log('Got shipment ID from query param:', returnShipmentId);
    }
    
    // Method 2: From path parameters
    if (!returnShipmentId && event.pathParameters && event.pathParameters.id) {
      returnShipmentId = event.pathParameters.id;
      console.log('Got shipment ID from path param:', returnShipmentId);
    }
    
    // Method 3: Parse from path manually
    if (!returnShipmentId) {
      const pathOnly = event.path.split('?')[0];
      const pathParts = pathOnly.split('/').filter(Boolean);
      const shipmentsIndex = pathParts.findIndex(part => part === 'return-shipments');
      if (shipmentsIndex >= 0 && pathParts[shipmentsIndex + 1]) {
        returnShipmentId = pathParts[shipmentsIndex + 1];
        console.log('Got shipment ID from path parsing:', returnShipmentId);
      }
    }

    if (!returnShipmentId || returnShipmentId === 'tracking') {
      console.error('Could not extract return_shipment_id');
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ 
          success: false, 
          error: 'Return shipment ID required',
          hint: 'Use: /.netlify/functions/add-return-tracking?return_shipment_id={id}',
        }),
      };
    }

    const body = JSON.parse(event.body || '{}');
    const { tracking_number, courier = 'fez' } = body;

    if (!tracking_number || !tracking_number.trim()) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: 'tracking_number required in request body' }),
      };
    }

    console.log('Saving tracking:', tracking_number, 'for shipment:', returnShipmentId);

    // Update return_shipment with tracking number
    const { data: shipment, error: updateError } = await supabase
      .from('return_shipments')
      .update({
        fez_tracking: tracking_number.trim(),
        status: 'in_transit',
        customer_submitted_tracking: true,
        tracking_submitted_at: new Date().toISOString(),
      })
      .eq('id', returnShipmentId)
      .select()
      .maybeSingle();

    if (updateError) {
      console.error('Database update error:', updateError);
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          error: 'Failed to save tracking: ' + updateError.message,
        }),
      };
    }

    if (!shipment) {
      console.error('Shipment not found:', returnShipmentId);
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          error: 'Return shipment not found',
        }),
      };
    }

    // Also update parent return_request status
    const { error: requestUpdateError } = await supabase
      .from('return_requests')
      .update({ status: 'in_transit' })
      .eq('id', shipment.return_request_id);

    if (requestUpdateError) {
      console.warn('Failed to update return_request status:', requestUpdateError);
    }

    console.log('✅ Tracking saved successfully');

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        data: {
          tracking_number: tracking_number.trim(),
          status: 'in_transit',
          shipment_id: shipment.id,
          return_code: shipment.return_code,
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
        error: 'Internal server error: ' + error.message,
      }),
    };
  }
}