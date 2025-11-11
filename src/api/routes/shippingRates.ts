import { Request, Response } from 'express';
import { createClient, type PostgrestError } from '@supabase/supabase-js';
import type { Database } from '../../types/supabase';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || '';
const supabase = createClient<Database>(supabaseUrl, supabaseKey);

// Types
type ShippingRateRow = Database['public']['Tables']['shipping_rates']['Row'];
type ShippingRateInsert = Database['public']['Tables']['shipping_rates']['Insert'];
type ShippingRateUpdate = Database['public']['Tables']['shipping_rates']['Update'];
type HubRef = Pick<Database['public']['Tables']['hubs']['Row'], 'id' | 'name' | 'code'>;
type ZoneRef = Pick<Database['public']['Tables']['zones']['Row'], 'id' | 'name' | 'code'>;
type CourierRef = Pick<Database['public']['Tables']['couriers']['Row'], 'id' | 'name' | 'code'>;
type RateWithRels = ShippingRateRow & { hubs?: HubRef | null; zones?: ZoneRef | null; couriers?: CourierRef | null };

// Utilities
const isUUID = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const toNullableNumber = (v: unknown) => {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
// Optional number (undefined when not provided or invalid)
const toNumberOptional = (v: unknown): number | undefined => {
  if (v === undefined || v === null || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
};

// Get all shipping rates with related data
export async function getShippingRatesHandler(_req: Request, res: Response) {
  try {
    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({ success: false, error: 'Supabase not configured on server' });
    }

    const { data: rates, error }: { data: RateWithRels[] | null; error: PostgrestError | null } = await supabase
      .from('shipping_rates')
      .select(`
        *,
        hubs(id, name, code),
        zones(id, name, code),
        couriers(id, name, code)
      `)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Mirror UI-friendly keys expected by dashboard
    const mapped = (rates || []).map((r) => ({
      ...r,
      origin_hub_id: r.hub_id,
      destination_zone_id: r.zone_id,
    }));

    return res.status(200).json({
      success: true,
      data: mapped,
    });
  } catch (error) {
    console.error('Get shipping rates error:', error);
    return res.status(500).json({
      error: 'Failed to fetch shipping rates',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

// Get single shipping rate
export async function getShippingRateByIdHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;

    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({ success: false, error: 'Supabase not configured on server' });
    }

    const { data: rate, error }: { data: RateWithRels | null; error: PostgrestError | null } = await supabase
      .from('shipping_rates')
      .select(`
        *,
        hubs(id, name, code),
        zones(id, name, code),
        couriers(id, name, code)
      `)
      .eq('id', id)
      .single();

    // Return 404 for non-existent IDs instead of 500
    if (error) {
      const msg = (error.message || '').toLowerCase();
      const code = error.code || '';
      if (code === 'PGRST116' || msg.includes('no rows')) {
        return res.status(404).json({ success: false, error: 'Shipping rate not found' });
      }
      throw error;
    }

    return res.status(200).json({
      success: true,
      data: rate ? { ...rate, origin_hub_id: rate.hub_id, destination_zone_id: rate.zone_id } : null,
    });
  } catch (error) {
    console.error('Get shipping rate error:', error);
    return res.status(500).json({
      error: 'Failed to fetch shipping rate',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

// Create shipping rate
export async function createShippingRateHandler(req: Request, res: Response) {
  try {
    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({ success: false, error: 'Supabase not configured on server' });
    }
    const body = req.body || {};
    // Coerce and validate required numeric first
    const flatRateNum = toNumberOptional(body.flat_rate);

    // Map UI fields -> DB schema
    const rateData: ShippingRateInsert = {
      hub_id: body.origin_hub_id || null,
      zone_id: body.destination_zone_id || null,
      courier_id: body.courier_id || null,
      flat_rate: flatRateNum as number,
      per_kg_rate: toNullableNumber(body.additional_weight_rate ?? body.per_kg_rate),
      min_weight_kg: toNullableNumber(body.min_weight ?? body.min_weight_kg),
      max_weight_kg: toNullableNumber(body.max_weight ?? body.max_weight_kg),
      free_shipping_threshold: toNullableNumber(body.free_shipping_threshold),
      is_active: body.is_active ?? true,
    };

    if (!rateData.hub_id || !rateData.zone_id || flatRateNum === undefined) {
      return res.status(400).json({ success: false, error: 'hub_id, zone_id and flat_rate are required' });
    }

    if (!isUUID(rateData.hub_id) || !isUUID(rateData.zone_id) || (rateData.courier_id && !isUUID(rateData.courier_id))) {
      return res.status(400).json({ success: false, error: 'Invalid hub_id/zone_id/courier_id' });
    }

    const { data: rate, error }: { data: ShippingRateRow | null; error: PostgrestError | null } = await supabase
      .from('shipping_rates')
      .insert([rateData])
      .select()
      .single();

    if (error) {
      const msg = (error.message || '').toLowerCase();
      const code = error.code || '';
      if (code === '23503') {
        return res.status(400).json({ success: false, error: 'Invalid hub/zone/courier reference' });
      }
      if (code === '23505' || msg.includes('duplicate key value')) {
        return res.status(409).json({ success: false, error: 'A shipping rate for this hub/zone/courier already exists' });
      }
      if (code === '23502' || msg.includes('null value in column')) {
        return res.status(400).json({ success: false, error: 'Missing required field(s)' });
      }
      throw error;
    }

    return res.status(201).json({
      success: true,
      data: rate,
    });
  } catch (error) {
    console.error('Create shipping rate error:', error);
    return res.status(500).json({
      error: 'Failed to create shipping rate',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

// Update shipping rate
export async function updateShippingRateHandler(req: Request, res: Response) {
  try {
    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({ success: false, error: 'Supabase not configured on server' });
    }
    const { id } = req.params;
    const body = req.body || {};
    const updateData: ShippingRateUpdate = {};

    // Validate ID format early
    if (!isUUID(id)) {
      return res.status(400).json({ success: false, error: 'Invalid shipping rate id' });
    }

    // Map and sanitize fields
    if (body.origin_hub_id !== undefined) {
      if (body.origin_hub_id !== null && !isUUID(body.origin_hub_id)) {
        return res.status(400).json({ success: false, error: 'Invalid origin_hub_id' });
      }
      updateData.hub_id = body.origin_hub_id || null;
    }
    if (body.destination_zone_id !== undefined) {
      if (body.destination_zone_id !== null && !isUUID(body.destination_zone_id)) {
        return res.status(400).json({ success: false, error: 'Invalid destination_zone_id' });
      }
      updateData.zone_id = body.destination_zone_id || null;
    }
    if (body.courier_id !== undefined) {
      if (body.courier_id !== null && !isUUID(body.courier_id)) {
        return res.status(400).json({ success: false, error: 'Invalid courier_id' });
      }
      updateData.courier_id = body.courier_id || null;
    }
    if (body.flat_rate !== undefined) updateData.flat_rate = toNumberOptional(body.flat_rate);
    if (body.additional_weight_rate !== undefined || body.per_kg_rate !== undefined) {
      updateData.per_kg_rate = toNullableNumber(body.additional_weight_rate ?? body.per_kg_rate);
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

    // If no valid fields provided
    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ success: false, error: 'No valid fields to update' });
    }

    const { data: rate, error }: { data: ShippingRateRow | null; error: PostgrestError | null } = await supabase
      .from('shipping_rates')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    // Return 404 if the rate does not exist
    if (error) {
      const msg = (error.message || '').toLowerCase();
      const code = error.code || '';
      if (code === 'PGRST116' || msg.includes('no rows')) {
        return res.status(404).json({ success: false, error: 'Shipping rate not found' });
      }
      if (code === '22P02' || msg.includes('invalid input syntax for type uuid')) {
        return res.status(400).json({ success: false, error: 'Invalid UUID provided' });
      }
      if (code === '23503') { // foreign_key_violation
        return res.status(400).json({ success: false, error: 'Invalid hub/zone/courier reference' });
      }
      if (code === '23502' || msg.includes('null value in column')) { // not_null_violation
        return res.status(400).json({ success: false, error: 'Missing required field(s)' });
      }
      if (code === '23505' || msg.includes('duplicate key value')) { // unique_violation
        return res.status(409).json({ success: false, error: 'A shipping rate for this hub/zone/courier already exists' });
      }
      throw error;
    }

    return res.status(200).json({
      success: true,
      data: rate,
    });
  } catch (error) {
    console.error('Update shipping rate error:', error);
    return res.status(500).json({
      error: 'Failed to update shipping rate',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

// Delete shipping rate
export async function deleteShippingRateHandler(req: Request, res: Response) {
  try {
    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({ success: false, error: 'Supabase not configured on server' });
    }
    const { id } = req.params;
    if (!isUUID(id)) {
      return res.status(400).json({ success: false, error: 'Invalid shipping rate id' });
    }

    const { error } = await supabase
      .from('shipping_rates')
      .delete()
      .eq('id', id);

    if (error) throw error;

    return res.status(200).json({
      success: true,
      message: 'Shipping rate deleted successfully',
    });
  } catch (error) {
    console.error('Delete shipping rate error:', error);
    return res.status(500).json({
      error: 'Failed to delete shipping rate',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
