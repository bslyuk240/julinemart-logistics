import { Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../types/supabase.js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient<Database>(supabaseUrl, supabaseKey);

// Get all hubs
export async function getHubsHandler(req: Request, res: Response) {
  try {
    const { data: hubs, error } = await supabase
      .from('hubs')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    return res.status(200).json({
      success: true,
      data: hubs || [],
    });
  } catch (error) {
    console.error('Get hubs error:', error);
    return res.status(500).json({
      error: 'Failed to fetch hubs',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

// Create hub
export async function createHubHandler(req: Request, res: Response) {
  try {
    const { name, code, address, city, state, phone, email, manager_name, manager_phone, is_active } = req.body || {};

    if (!name || !code || !address || !city || !state) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        message: 'name, code, address, city and state are required',
      });
    }

    const { data, error } = await supabase
      .from('hubs')
      .insert([{ name, code, address, city, state, phone, email, manager_name, manager_phone, is_active }])
      .select('*')
      .single();

    if (error) throw error;

    return res.status(201).json({ success: true, data });
  } catch (error) {
    console.error('Create hub error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to create hub',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

// Update hub
export async function updateHubHandler(req: Request, res: Response) {
  try {
    const { id } = req.params as { id: string };
    const { name, code, address, city, state, phone, email, manager_name, manager_phone, is_active } = req.body || {};

    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (code !== undefined) updateData.code = code;
    if (address !== undefined) updateData.address = address;
    if (city !== undefined) updateData.city = city;
    if (state !== undefined) updateData.state = state;
    if (phone !== undefined) updateData.phone = phone;
    if (email !== undefined) updateData.email = email;
    if (manager_name !== undefined) updateData.manager_name = manager_name;
    if (manager_phone !== undefined) updateData.manager_phone = manager_phone;
    if (is_active !== undefined) updateData.is_active = is_active;

    const { data, error } = await supabase
      .from('hubs')
      .update(updateData)
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw error;

    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('Update hub error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to update hub',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

// Delete hub
export async function deleteHubHandler(req: Request, res: Response) {
  try {
    const { id } = req.params as { id: string };

    const { error } = await supabase
      .from('hubs')
      .delete()
      .eq('id', id);

    if (error) throw error;

    return res.status(204).send();
  } catch (error) {
    console.error('Delete hub error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to delete hub',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

// Get all couriers
export async function getCouriersHandler(req: Request, res: Response) {
  try {
    const { data: couriers, error } = await supabase
      .from('couriers')
      .select('*')
      .order('name');

    if (error) throw error;

    return res.status(200).json({
      success: true,
      data: couriers || [],
    });
  } catch (error) {
    console.error('Get couriers error:', error);
    return res.status(500).json({
      error: 'Failed to fetch couriers',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

// Create courier
export async function createCourierHandler(req: Request, res: Response) {
  try {
    const { name, code, is_active } = req.body || {};

    if (!name || !code) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        message: 'name and code are required',
      });
    }

    // Schema requires `type courier_type NOT NULL`; default to 'other'
    const { data, error } = await supabase
      .from('couriers')
      .insert([{ name, code, is_active, type: 'other' }])
      .select('*')
      .single();

    if (error) throw error;

    return res.status(201).json({ success: true, data });
  } catch (error) {
    console.error('Create courier error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to create courier',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

// Update courier
export async function updateCourierHandler(req: Request, res: Response) {
  try {
    const { id } = req.params as { id: string };
    const { name, code, is_active, api_url, webhook_url, base_rate, rate_per_kg } = req.body || {};

    // Only include columns that exist in the couriers schema
    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (code !== undefined) updateData.code = code;
    if (is_active !== undefined) updateData.is_active = is_active;
    if (api_url !== undefined) updateData.api_url = api_url;
    if (webhook_url !== undefined) updateData.webhook_url = webhook_url;
    if (base_rate !== undefined) updateData.base_rate = base_rate;
    if (rate_per_kg !== undefined) updateData.rate_per_kg = rate_per_kg;

    const { data, error } = await supabase
      .from('couriers')
      .update(updateData)
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw error;

    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('Update courier error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to update courier',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

// Delete courier
export async function deleteCourierHandler(req: Request, res: Response) {
  try {
    const { id } = req.params as { id: string };

    const { error } = await supabase
      .from('couriers')
      .delete()
      .eq('id', id);

    if (error) throw error;

    return res.status(204).send();
  } catch (error) {
    console.error('Delete courier error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to delete courier',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

// Get all zones with rates
export async function getZonesWithRatesHandler(req: Request, res: Response) {
  try {
    const { data: zones, error } = await supabase
      .from('zones')
      .select(`
        *,
        shipping_rates (
          id,
          flat_rate,
          per_kg_rate,
          free_shipping_threshold,
          is_active
        )
      `)
      .order('name');

    if (error) throw error;

    return res.status(200).json({
      success: true,
      data: zones || [],
    });
  } catch (error) {
    console.error('Get zones error:', error);
    return res.status(500).json({
      error: 'Failed to fetch zones',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

// Get dashboard stats
export async function getDashboardStatsHandler(req: Request, res: Response) {
  try {
    // Get total orders count
    const { count: ordersCount } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true });

    // Get active hubs count
    const { count: hubsCount } = await supabase
      .from('hubs')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true);

    // Get active couriers count
    const { count: couriersCount } = await supabase
      .from('couriers')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true);

    // Get average delivery time from zones
    const { data: zones } = await supabase
      .from('zones')
      .select('estimated_delivery_days');

    const avgDeliveryTime = zones && zones.length > 0
      ? zones.reduce((sum, z) => sum + (z.estimated_delivery_days || 0), 0) / zones.length
      : 0;

    return res.status(200).json({
      success: true,
      data: {
        totalOrders: ordersCount || 0,
        activeHubs: hubsCount || 0,
        activeCouriers: couriersCount || 0,
        avgDeliveryTime: Number(avgDeliveryTime.toFixed(1)),
      },
    });
  } catch (error) {
    console.error('Get stats error:', error);
    return res.status(500).json({
      error: 'Failed to fetch stats',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
