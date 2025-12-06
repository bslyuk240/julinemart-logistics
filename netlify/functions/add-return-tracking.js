import { createClient } from '@supabase/supabase-js';
import { corsHeaders, preflightResponse } from './services/cors.js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL || '', SERVICE_KEY || '');

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return preflightResponse();
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
  }

  const parts = event.path.split('/');
  const id = parts[parts.findIndex((p) => p === 'return-shipments') + 1];

  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const tracking = body.tracking_number;
    const courier = body.courier || 'fez';

    if (!tracking) {
      return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ success: false, error: 'tracking_number required' }) };
    }

    const { data: existing, error: fetchErr } = await supabase
      .from('return_shipments')
      .select('id, return_request_id')
      .eq('id', id)
      .single();

    if (fetchErr || !existing) {
      return { statusCode: 404, headers: corsHeaders(), body: JSON.stringify({ success: false, error: 'Return shipment not found' }) };
    }

    const { error: updateErr } = await supabase
      .from('return_shipments')
      .update({
        fez_tracking: tracking,
        status: 'in_transit',
        customer_submitted_tracking: true,
        tracking_submitted_at: new Date().toISOString(),
        courier,
      })
      .eq('id', id);

    if (updateErr) throw updateErr;

    if (existing.return_request_id) {
      await supabase
        .from('return_requests')
        .update({ status: 'in_transit' })
        .eq('id', existing.return_request_id);
    }

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({ success: true, data: { id, tracking_number: tracking } }),
    };
  } catch (error) {
    console.error('add-return-tracking error:', error);
    return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ success: false, error: error.message || 'Internal error' }) };
  }
}
