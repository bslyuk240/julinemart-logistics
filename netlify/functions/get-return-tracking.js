import { createClient } from '@supabase/supabase-js';
import { corsHeaders, preflightResponse } from './services/cors.js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;
const FEZ_BASE = (process.env.FEZ_API_BASE_URL || process.env.FEZ_API_URL || '').replace(/\/$/, '');
const FEZ_USER = process.env.FEZ_USER_ID;
const FEZ_PASSWORD = process.env.FEZ_PASSWORD || process.env.FEZ_API_KEY;
const supabase = createClient(SUPABASE_URL || '', SERVICE_KEY || '');

async function fetchFezTracking(trackingNumber) {
  if (!FEZ_BASE || !FEZ_USER || !FEZ_PASSWORD) {
    throw new Error('Fez API not configured');
  }
  const authRes = await fetch(`${FEZ_BASE}/user/authenticate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: FEZ_USER, password: FEZ_PASSWORD }),
  });
  const auth = await authRes.json();
  if (auth?.status !== 'Success') throw new Error(auth?.description || 'Fez auth failed');
  const token = auth.authDetails?.authToken;
  const secret = auth.orgDetails?.['secret-key'];

  const res = await fetch(`${FEZ_BASE}/order/track/${trackingNumber}`, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'secret-key': secret,
    },
  });
  const text = await res.text();
  let data = {};
  try {
    data = JSON.parse(text);
  } catch {
    data = {};
  }
  if (!res.ok) {
    throw new Error(data?.description || data?.message || text || 'Fez tracking failed');
  }
  return data;
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return preflightResponse();
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
  }

  const parts = event.path.split('/');
  const returnRequestId = parts[parts.findIndex((p) => p === 'returns') + 1];

  try {
    const { data: shipment, error: fetchErr } = await supabase
      .from('return_shipments')
      .select('id, return_code, fez_tracking, status, return_request_id')
      .eq('return_request_id', returnRequestId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (fetchErr || !shipment) {
      return { statusCode: 404, headers: corsHeaders(), body: JSON.stringify({ success: false, error: 'Return shipment not found' }) };
    }

    if (!shipment.fez_tracking) {
      return {
        statusCode: 200,
        headers: corsHeaders(),
        body: JSON.stringify({
          success: true,
          data: {
            return_code: shipment.return_code,
            tracking_number: null,
            status: 'awaiting_tracking',
            events: [],
          },
        }),
      };
    }

    let events = [];
    let status = shipment.status || 'in_transit';
    let estimated_delivery = null;
    try {
      const fezData = await fetchFezTracking(shipment.fez_tracking);
      status = fezData?.order?.orderStatus || status;
      estimated_delivery = fezData?.order?.estimatedDeliveryDate || null;
      if (Array.isArray(fezData?.orderEvents)) {
        events = fezData.orderEvents.map((ev) => ({
          status: ev.orderStatus || ev.status || 'Update',
          location: ev.location || '',
          timestamp: ev.updated_at || ev.date || ev.time || ev.created_at,
        }));
      }
    } catch (err) {
      console.error('Fez tracking fetch failed:', err);
    }

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({
        success: true,
        data: {
          return_code: shipment.return_code,
          tracking_number: shipment.fez_tracking,
          status,
          events,
          estimated_delivery,
        },
      }),
    };
  } catch (error) {
    console.error('get-return-tracking error:', error);
    return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ success: false, error: error.message || 'Internal error' }) };
  }
}
