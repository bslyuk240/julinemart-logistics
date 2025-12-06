// POST /api/return-shipments/:id/tracking - Save customer tracking number
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
    // Extract return_shipment_id from path: /api/return-shipments/:id/tracking
    const pathParts = event.path.split('/').filter(Boolean);
    const shipmentsIndex = pathParts.indexOf('return-shipments');
    const returnShipmentId = shipmentsIndex >= 0 ? pathParts[shipmentsIndex + 1] : null;

    if (!returnShipmentId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: 'Return shipment ID required in URL' }),
      };
    }

    const body = JSON.parse(event.body || '{}');
    const { tracking_number, courier = 'fez' } = body;

    if (!tracking_number || !tracking_number.trim()) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: 'tracking_number required in body' }),
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
      .single();

    if (updateError || !shipment) {
      console.error('Update failed:', updateError);
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          error: 'Failed to save tracking: ' + (updateError?.message || 'Shipment not found'),
        }),
      };
    }

    // Also update parent return_request status
    await supabase
      .from('return_requests')
      .update({ status: 'in_transit' })
      .eq('id', shipment.return_request_id);

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
    console.error('Error saving tracking:', error);
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