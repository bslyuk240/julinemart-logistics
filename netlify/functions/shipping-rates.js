// Netlify Function: /api/shipping-rates and /api/shipping-rates/:id
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // Extract potential id from path: /.netlify/functions/shipping-rates/:id
  const parts = event.path.split('/');
  const idx = parts.findIndex((p) => p === 'shipping-rates');
  const id = idx >= 0 && parts.length > idx + 1 ? parts[idx + 1] : undefined;

  try {
    if (event.httpMethod === 'GET') {
      if (id) {
        const { data, error } = await supabase
          .from('shipping_rates')
          .select('*')
          .eq('id', id)
          .single();
        if (error) throw error;
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, data }) };
      }
      const { data, error } = await supabase
        .from('shipping_rates')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: data || [] }) };
    }

    if (event.httpMethod === 'POST') {
      const payload = JSON.parse(event.body || '{}');
      const { data, error } = await supabase
        .from('shipping_rates')
        .insert([payload])
        .select()
        .single();
      if (error) throw error;
      return { statusCode: 201, headers, body: JSON.stringify({ success: true, data }) };
    }

    if (event.httpMethod === 'PUT' && id) {
      const payload = JSON.parse(event.body || '{}');
      const { data, error } = await supabase
        .from('shipping_rates')
        .update(payload)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, data }) };
    }

    if (event.httpMethod === 'DELETE' && id) {
      const { error } = await supabase
        .from('shipping_rates')
        .delete()
        .eq('id', id);
      if (error) throw error;
      return { statusCode: 204, headers, body: '' };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: 'Method Not Allowed' }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: 'Error handling shipping rates' }) };
  }
}

