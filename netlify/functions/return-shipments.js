// Netlify Function: /api/return-shipments/*
// Supports:
//   GET    /api/return-shipments/order/:orderId   -> list return shipments for an order
//   PATCH  /api/return-shipments/:id/status       -> update a return shipment status

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

const supabase = createClient(SUPABASE_URL || '', SERVICE_KEY || '');

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
};

function parsePath(eventPath) {
  const parts = eventPath.replace(/^\/+|\/+$/g, '').split('/');
  const idx = parts.indexOf('return-shipments');
  const first = idx >= 0 && parts[idx + 1] ? parts[idx + 1] : undefined;
  const second = idx >= 0 && parts[idx + 2] ? parts[idx + 2] : undefined;
  return { first, second };
}

function isMissingTable(error, table) {
  return typeof error?.message === 'string' && error.message.toLowerCase().includes(table);
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: 'Supabase not configured' }),
    };
  }

  const { first, second } = parsePath(event.path);

  try {
    // GET /api/return-shipments/order/:orderId
    if (event.httpMethod === 'GET' && first === 'order' && second) {
      const orderId = second;

      const { data: requests, error: requestError } = await supabase
        .from('return_requests')
        .select('id')
        .eq('order_id', orderId);

      if (requestError) {
        if (isMissingTable(requestError, 'return_requests')) {
          console.warn('return_requests table missing, returning empty list');
          return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: [] }) };
        }
        throw requestError;
      }

      const requestIds = (requests || []).map((r) => r.id);
      if (!requestIds.length) {
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: [] }) };
      }

      const { data: shipments, error: shipmentError } = await supabase
        .from('return_shipments')
        .select('*')
        .in('return_request_id', requestIds)
        .order('created_at', { ascending: false });

      if (shipmentError) {
        if (isMissingTable(shipmentError, 'return_shipments')) {
          console.warn('return_shipments table missing, returning empty list');
          return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: [] }) };
        }
        throw shipmentError;
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, data: shipments || [] }),
      };
    }

    // PATCH /api/return-shipments/:id/status
    if (event.httpMethod === 'PATCH' && first && second === 'status') {
      const shipmentId = first;
      const payload = event.body ? JSON.parse(event.body) : {};
      const { status } = payload || {};

      if (!status) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ success: false, error: 'Status is required' }),
        };
      }

      const { data, error } = await supabase
        .from('return_shipments')
        .update({ status })
        .eq('id', shipmentId)
        .select('*')
        .single();

      if (error) throw error;

      return { statusCode: 200, headers, body: JSON.stringify({ success: true, data }) };
    }

    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ success: false, error: 'Method Not Allowed' }),
    };
  } catch (err) {
    console.error('RETURN SHIPMENTS FUNCTION ERROR:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Failed to handle return shipments',
        message: err?.message || 'Unknown error',
      }),
    };
  }
}
