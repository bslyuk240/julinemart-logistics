import { createClient } from '@supabase/supabase-js';
import { corsHeaders, preflightResponse } from './services/cors.js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL || '', SERVICE_KEY || '');

const ALLOWED_STATUSES = new Set([
  'awaiting_tracking',
  'in_transit',
  'delivered_to_hub',
  'inspection_in_progress',
  'approved',
  'rejected',
  'pickup_scheduled',
  'awaiting_dropoff',
  'pending',
  'delivered',
  'completed',
]);

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return preflightResponse();
  if (event.httpMethod !== 'PATCH') {
    return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
  }

  const parts = event.path.split('/');
  const id = parts[parts.findIndex((p) => p === 'return-shipments') + 1];

  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const status = body.status;
    const adminUserId = body.user_id || null;

    if (!status || !ALLOWED_STATUSES.has(status)) {
      return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ success: false, error: 'Invalid status' }) };
    }

    const { data: shipment, error: fetchErr } = await supabase
      .from('return_shipments')
      .select('id, return_request_id')
      .eq('id', id)
      .single();

    if (fetchErr || !shipment) {
      return { statusCode: 404, headers: corsHeaders(), body: JSON.stringify({ success: false, error: 'Return shipment not found' }) };
    }

    const { data: updated, error: updateErr } = await supabase
      .from('return_shipments')
      .update({
        status,
        updated_by: adminUserId,
      })
      .eq('id', id)
      .select('*')
      .single();

    if (updateErr) throw updateErr;

    if (shipment.return_request_id) {
      await supabase
        .from('return_requests')
        .update({ status })
        .eq('id', shipment.return_request_id);
    }

    // Notification hook could go here (delivered_to_hub)

    return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ success: true, data: updated }) };
  } catch (error) {
    console.error('update-return-status error:', error);
    return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ success: false, error: error.message || 'Internal error' }) };
  }
}
