/**
 * POST /api/vendor-qr-scan
 * Body: { vendor_id, source? }
 */
import { createClient } from '@supabase/supabase-js';
import { corsHeaders, preflightResponse } from './services/cors.js';

const adminClient = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return preflightResponse();
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const vendorId = String(body.vendor_id || '').trim();
    if (!vendorId) {
      return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'vendor_id required' }) };
    }

    await adminClient.from('vendor_qr_scans').insert({
      vendor_woo_id: vendorId,
      source: body.source || 'store_qr',
      metadata: body.metadata || {},
    });

    return {
      statusCode: 201,
      headers: corsHeaders(),
      body: JSON.stringify({ success: true }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ error: err?.message || 'Failed to record scan' }),
    };
  }
}
