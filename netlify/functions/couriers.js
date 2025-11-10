// Netlify Function: /api/couriers
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL || '', SERVICE_KEY || '');

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
};

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // Parse potential id from path
  const parts = event.path.split('/');
  const idx = parts.findIndex((p) => p === 'couriers');
  const id = idx >= 0 && parts.length > idx + 1 ? parts[idx + 1] : undefined;
  const tail = idx >= 0 && parts.length > idx + 2 ? parts[idx + 2] : undefined; // e.g., 'credentials'

  try {
    if (event.httpMethod === 'GET') {
      if (id) {
        const { data, error } = await supabase
          .from('couriers')
          .select('*')
          .eq('id', id)
          .single();
        if (error) throw error;
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, data }) };
      }
      const { data, error } = await supabase
        .from('couriers')
        .select('id, name, code, contact_person, contact_phone, contact_email, is_active, created_at')
        .order('name');
      if (error) throw error;
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: data || [] }) };
    }

    if (event.httpMethod === 'POST') {
      const payload = JSON.parse(event.body || '{}');
      const { data, error } = await supabase
        .from('couriers')
        .insert([payload])
        .select()
        .single();
      if (error) throw error;
      return { statusCode: 201, headers, body: JSON.stringify({ success: true, data }) };
    }

    // Update API credentials or enable/disable: /api/couriers/:id/credentials
    if (event.httpMethod === 'PUT' && id && tail === 'credentials') {
      const { api_key, api_secret, api_enabled } = JSON.parse(event.body || '{}');
      const updateData = {};
      if (api_key !== undefined) updateData.api_key_encrypted = api_key;
      if (api_secret !== undefined) updateData.api_secret_encrypted = api_secret;
      if (api_enabled !== undefined) updateData.api_enabled = api_enabled;
      const { error } = await supabase.from('couriers').update(updateData).eq('id', id);
      if (error) throw error;
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: 'Credentials updated' }) };
    }

    if (event.httpMethod === 'PUT' && id) {
      const payload = JSON.parse(event.body || '{}');
      const { data, error } = await supabase
        .from('couriers')
        .update(payload)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, data }) };
    }

    if (event.httpMethod === 'DELETE' && id) {
      const { error } = await supabase
        .from('couriers')
        .delete()
        .eq('id', id);
      if (error) throw error;
      return { statusCode: 204, headers, body: '' };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: 'Method Not Allowed' }) };
  } catch (e) {
    console.error('Couriers function error:', e);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: 'Failed to handle couriers' }) };
  }
}
