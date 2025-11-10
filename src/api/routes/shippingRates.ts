import { Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../types/supabase';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

// Get all shipping rates with related data
export async function getShippingRatesHandler(_req: Request, res: Response) {
  try {
    const { data: rates, error } = await supabase
      .from('shipping_rates')
      .select(`
        *,
        hubs:hub_id(id, name, code),
        zones:zone_id(id, name, code),
        couriers:courier_id(id, name, code)
      `)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return res.status(200).json({
      success: true,
      data: rates || [],
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

    const { data: rate, error } = await supabase
      .from('shipping_rates')
      .select(`
        *,
        hubs:hub_id(id, name, code),
        zones:zone_id(id, name, code),
        couriers:courier_id(id, name, code)
      `)
      .eq('id', id)
      .single();

    if (error) throw error;

    return res.status(200).json({
      success: true,
      data: rate,
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
    const body = req.body || {};
    // Map UI fields -> DB schema
    const rateData: any = {
      hub_id: body.origin_hub_id,
      zone_id: body.destination_zone_id,
      courier_id: body.courier_id,
      flat_rate: body.flat_rate,
      per_kg_rate: body.additional_weight_rate ?? body.per_kg_rate ?? null,
      min_weight_kg: body.min_weight ?? body.min_weight_kg ?? null,
      max_weight_kg: body.max_weight ?? body.max_weight_kg ?? null,
      free_shipping_threshold: body.free_shipping_threshold ?? null,
      is_active: body.is_active ?? true,
    };

    if (!rateData.hub_id || !rateData.zone_id || rateData.flat_rate === undefined) {
      return res.status(400).json({ success: false, error: 'hub_id, zone_id and flat_rate are required' });
    }

    const { data: rate, error } = await supabase
      .from('shipping_rates')
      .insert([rateData])
      .select()
      .single();

    if (error) throw error;

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
    const { id } = req.params;
    const body = req.body || {};
    const updateData: any = {};
    if (body.origin_hub_id !== undefined) updateData.hub_id = body.origin_hub_id;
    if (body.destination_zone_id !== undefined) updateData.zone_id = body.destination_zone_id;
    if (body.courier_id !== undefined) updateData.courier_id = body.courier_id;
    if (body.flat_rate !== undefined) updateData.flat_rate = body.flat_rate;
    if (body.additional_weight_rate !== undefined || body.per_kg_rate !== undefined) updateData.per_kg_rate = body.additional_weight_rate ?? body.per_kg_rate;
    if (body.min_weight !== undefined || body.min_weight_kg !== undefined) updateData.min_weight_kg = body.min_weight ?? body.min_weight_kg;
    if (body.max_weight !== undefined || body.max_weight_kg !== undefined) updateData.max_weight_kg = body.max_weight ?? body.max_weight_kg;
    if (body.free_shipping_threshold !== undefined) updateData.free_shipping_threshold = body.free_shipping_threshold;
    if (body.is_active !== undefined) updateData.is_active = body.is_active;

    const { data: rate, error } = await supabase
      .from('shipping_rates')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

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
    const { id } = req.params;

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
