// List returns for a customer (wc_customer_id or customer_email)
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
    const url = new URL(event.rawUrl);
    const wcCustomerId = url.searchParams.get('wc_customer_id');
    const email = url.searchParams.get('customer_email');

    if (!wcCustomerId && !email) {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'wc_customer_id or customer_email required' }) };
    }

    let query = supabase
      .from('return_requests')
      .select('*, return_shipments(*)')
      .order('created_at', { ascending: false });

    if (wcCustomerId) query = query.eq('wc_customer_id', wcCustomerId);
    if (email) query = query.eq('customer_email', email);

    const { data, error } = await query;
    if (error) throw error;

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: data || [] }) };
  } catch (error) {
    console.error('returns-list error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: error.message || 'Internal error' }) };
  }
}
