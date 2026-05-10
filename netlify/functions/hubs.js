// Netlify Function: /api/hubs
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL || '', SERVICE_KEY || '');

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

function parseMetadata(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  return {};
}

function pickPostcode(metadata = {}) {
  return (
    metadata.postcode ||
    metadata.postal_code ||
    metadata.zip ||
    metadata.zip_code ||
    ''
  );
}

function shapeHub(row) {
  if (!row) return row;
  const metadata = parseMetadata(row.metadata);
  return {
    ...row,
    metadata,
    postcode: pickPostcode(metadata),
  };
}

function buildHubMetadata(existingMetadata = {}, body = {}) {
  const metadata = {
    ...parseMetadata(existingMetadata),
  };

  if (body.postcode !== undefined) {
    const postcode = String(body.postcode || '').trim();
    if (postcode) {
      metadata.postcode = postcode;
    } else {
      delete metadata.postcode;
    }
  }

  return metadata;
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  try {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: 'Supabase not configured on server' }) };
    }

    // Parse potential id: /.netlify/functions/hubs/:id
    const parts = event.path.split('/');
    const idx = parts.findIndex((p) => p === 'hubs');
    const id = idx >= 0 && parts.length > idx + 1 ? parts[idx + 1] : undefined;

    if (event.httpMethod === 'GET') {
      const { data, error } = await supabase
        .from('hubs')
        .select('id, name, code, address, city, state, phone, email, manager_name, manager_phone, is_active, is_sub_hub, parent_hub_id, metadata, parent_hub:hubs!parent_hub_id(id, name, city)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, data: (data || []).map(shapeHub) })
      };
    }

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const required = ['name', 'code', 'address', 'city', 'state'];
      for (const k of required) {
        if (!body[k]) {
          return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: `Missing required field: ${k}` }) };
        }
      }
      const isSubHub = Boolean(body.is_sub_hub);
      const { data, error } = await supabase
        .from('hubs')
        .insert([{
          name: body.name,
          code: body.code,
          address: body.address,
          city: body.city,
          state: body.state,
          phone: body.phone,
          email: body.email,
          manager_name: body.manager_name,
          manager_phone: body.manager_phone,
          is_active: body.is_active ?? true,
          is_sub_hub: isSubHub,
          parent_hub_id: isSubHub ? (body.parent_hub_id || null) : null,
          metadata: buildHubMetadata({}, body),
        }])
        .select('*')
        .single();
      if (error) throw error;
      return { statusCode: 201, headers, body: JSON.stringify({ success: true, data: shapeHub(data) }) };
    }

    if (event.httpMethod === 'PUT' && id) {
      const body = JSON.parse(event.body || '{}');
      const update = {};
      ['name','code','address','city','state','phone','email','manager_name','manager_phone','is_active']
        .forEach((k) => { if (body[k] !== undefined) update[k] = body[k]; });
      if (body.is_sub_hub !== undefined) {
        update.is_sub_hub = Boolean(body.is_sub_hub);
        update.parent_hub_id = update.is_sub_hub ? (body.parent_hub_id || null) : null;
      }
      if (body.postcode !== undefined) {
        const { data: currentHub, error: currentHubError } = await supabase
          .from('hubs')
          .select('metadata')
          .eq('id', id)
          .single();
        if (currentHubError) throw currentHubError;
        update.metadata = buildHubMetadata(currentHub?.metadata, body);
      }
      if (Object.keys(update).length === 0) {
        return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'No valid fields to update' }) };
      }
      const { data, error } = await supabase
        .from('hubs')
        .update(update)
        .eq('id', id)
        .select('*')
        .single();
      if (error) throw error;
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: shapeHub(data) }) };
    }

    if (event.httpMethod === 'DELETE' && id) {
      const { error } = await supabase
        .from('hubs')
        .delete()
        .eq('id', id);
      if (error) throw error;
      return { statusCode: 204, headers, body: '' };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: 'Method Not Allowed' }) };
  } catch (e) {
    console.error('hubs function error:', e);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: 'Failed to handle hubs', message: e?.message || 'Unknown error' }) };
  }
}
