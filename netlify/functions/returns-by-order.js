// Get returns for a specific order (by Woo order id)
import { supabase } from './services/returns-utils.js';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
};

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: 'Method not allowed' }) };

  try {
    const parts = event.path.split('/');
    const idx = parts.findIndex((p) => p === 'orders');
    const orderId = idx >= 0 ? parts[idx + 1] : null;
    if (!orderId) {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'order_id required in path' }) };
    }

    const { data, error } = await supabase
      .from('return_requests')
      .select('*, return_shipments(*)')
      .eq('order_id', orderId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: data || [] }) };
  } catch (error) {
    console.error('returns-by-order error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: error.message || 'Internal error' }) };
  }
}
