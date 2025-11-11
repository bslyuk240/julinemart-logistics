// Netlify Function: /api/shipping-rates and /api/shipping-rates/:id
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL || '', SERVICE_KEY || '');

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

  const isUUID = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
  const toNullableNumber = (v) => {
    if (v === undefined || v === null || v === '') return null;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const toNumberOptional = (v) => {
    if (v === undefined || v === null || v === '') return undefined;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : undefined;
  };

  try {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: 'Supabase not configured on server' }) };
    }
    if (event.httpMethod === 'GET') {
      if (id) {
        const { data, error } = await supabase
          .from('shipping_rates')
          .select(`
            *,
            hubs(id, name, code),
            zones(id, name, code),
            couriers(id, name, code)
          `)
          .eq('id', id)
          .single();
        if (error) throw error;
        const mapped = data ? { ...data, origin_hub_id: data.hub_id, destination_zone_id: data.zone_id } : null;
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: mapped }) };
      }
      const { data, error } = await supabase
        .from('shipping_rates')
        .select(`
          *,
          hubs(id, name, code),
          zones(id, name, code),
          couriers(id, name, code)
        `)
        .order('created_at', { ascending: false });
      if (error) throw error;
      const mapped = (data || []).map((r) => ({ ...r, origin_hub_id: r.hub_id, destination_zone_id: r.zone_id }));
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: mapped }) };
    }

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');

      const flatRateNum = toNumberOptional(body.flat_rate);
      const rateData = {
        hub_id: body.origin_hub_id || null,
        zone_id: body.destination_zone_id || null,
        courier_id: body.courier_id || null,
        flat_rate: flatRateNum,
        per_kg_rate: toNullableNumber(body.additional_weight_rate ?? body.per_kg_rate),
        min_weight_kg: toNullableNumber(body.min_weight ?? body.min_weight_kg),
        max_weight_kg: toNullableNumber(body.max_weight ?? body.max_weight_kg),
        free_shipping_threshold: toNullableNumber(body.free_shipping_threshold),
        is_active: body.is_active ?? true,
      };

      if (!rateData.hub_id || !rateData.zone_id || flatRateNum === undefined) {
        return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'hub_id, zone_id and flat_rate are required' }) };
      }
      if (!isUUID(rateData.hub_id) || !isUUID(rateData.zone_id) || (rateData.courier_id && !isUUID(rateData.courier_id))) {
        return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Invalid hub_id/zone_id/courier_id' }) };
      }

      const { data, error } = await supabase
        .from('shipping_rates')
        .insert([{ ...rateData, flat_rate: flatRateNum }])
        .select()
        .single();
      if (error) {
        const msg = (error.message || '').toLowerCase();
        const code = error.code || '';
        if (code === '23503') {
          return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Invalid hub/zone/courier reference' }) };
        }
        if (code === '23505' || msg.includes('duplicate key value')) {
          return { statusCode: 409, headers, body: JSON.stringify({ success: false, error: 'A shipping rate for this hub/zone/courier already exists' }) };
        }
        if (code === '23502' || msg.includes('null value in column')) {
          return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Missing required field(s)' }) };
        }
        throw error;
      }
      const mapped = data ? { ...data, origin_hub_id: data.hub_id, destination_zone_id: data.zone_id } : null;
      return { statusCode: 201, headers, body: JSON.stringify({ success: true, data: mapped }) };
    }

    if (event.httpMethod === 'PUT' && id) {
      const body = JSON.parse(event.body || '{}');

      if (!isUUID(id)) {
        return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Invalid shipping rate id' }) };
      }

      const updateData = {};
      if (body.origin_hub_id !== undefined) {
        if (body.origin_hub_id !== null && !isUUID(body.origin_hub_id)) {
          return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Invalid origin_hub_id' }) };
        }
        updateData.hub_id = body.origin_hub_id || null;
      }
      if (body.destination_zone_id !== undefined) {
        if (body.destination_zone_id !== null && !isUUID(body.destination_zone_id)) {
          return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Invalid destination_zone_id' }) };
        }
        updateData.zone_id = body.destination_zone_id || null;
      }
      if (body.courier_id !== undefined) {
        if (body.courier_id !== null && !isUUID(body.courier_id)) {
          return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Invalid courier_id' }) };
        }
        updateData.courier_id = body.courier_id || null;
      }
      if (body.flat_rate !== undefined) {
        const n = toNumberOptional(body.flat_rate);
        if (n !== undefined) updateData.flat_rate = n;
      }
      if (body.additional_weight_rate !== undefined || body.per_kg_rate !== undefined) {
        const n = toNullableNumber(body.additional_weight_rate ?? body.per_kg_rate);
        updateData.per_kg_rate = n;
      }
      if (body.min_weight !== undefined || body.min_weight_kg !== undefined) {
        updateData.min_weight_kg = toNullableNumber(body.min_weight ?? body.min_weight_kg);
      }
      if (body.max_weight !== undefined || body.max_weight_kg !== undefined) {
        updateData.max_weight_kg = toNullableNumber(body.max_weight ?? body.max_weight_kg);
      }
      if (body.free_shipping_threshold !== undefined) {
        updateData.free_shipping_threshold = toNullableNumber(body.free_shipping_threshold);
      }
      if (body.is_active !== undefined) updateData.is_active = !!body.is_active;

      if (Object.keys(updateData).length === 0) {
        return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'No valid fields to update' }) };
      }

      const { data, error } = await supabase
        .from('shipping_rates')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        const msg = (error.message || '').toLowerCase();
        const code = error.code || '';
        if (code === 'PGRST116' || msg.includes('no rows')) {
          return { statusCode: 404, headers, body: JSON.stringify({ success: false, error: 'Shipping rate not found' }) };
        }
        if (code === '22P02' || msg.includes('invalid input syntax for type uuid')) {
          return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Invalid UUID provided' }) };
        }
        if (code === '23503') {
          return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Invalid hub/zone/courier reference' }) };
        }
        if (code === '23502' || msg.includes('null value in column')) {
          return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Missing required field(s)' }) };
        }
        if (code === '23505' || msg.includes('duplicate key value')) {
          return { statusCode: 409, headers, body: JSON.stringify({ success: false, error: 'A shipping rate for this hub/zone/courier already exists' }) };
        }
        throw error;
      }
      const mapped = data ? { ...data, origin_hub_id: data.hub_id, destination_zone_id: data.zone_id } : null;
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: mapped }) };
    }

    if (event.httpMethod === 'DELETE' && id) {
      if (!isUUID(id)) {
        return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Invalid shipping rate id' }) };
      }
      const { error } = await supabase
        .from('shipping_rates')
        .delete()
        .eq('id', id);
      if (error) throw error;
      return { statusCode: 204, headers, body: '' };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: 'Method Not Allowed' }) };
  } catch (e) {
    console.error('shipping-rates function error:', e);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: 'Error handling shipping rates', message: e?.message || 'Unknown error' }) };
  }
}
