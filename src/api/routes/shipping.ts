import { Request, Response } from 'express';
import { calculateShipping } from '../services/shippingCalculator.js';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

export async function calcShippingHandler(req: Request, res: Response) {
  try {
    const { deliveryState, deliveryCity, items, totalOrderValue } = req.body;

    // Validation
    if (!deliveryState || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: deliveryState, items[]'
      });
    }

    // Calculate shipping
    const result = await calculateShipping({
      deliveryState,
      deliveryCity,
      items,
      totalOrderValue: totalOrderValue || 0
    });

    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Shipping calculation error:', error);
    return res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to calculate shipping'
    });
  }
}

export async function getZoneHandler(req: Request, res: Response) {
  try {
    const { state } = req.params;

    if (!state) {
      return res.status(400).json({
        success: false,
        error: 'State parameter is required'
      });
    }

    const { data: zones } = await supabase
      .from('zones')
      .select('*');

    if (!zones) {
      return res.status(404).json({
        success: false,
        error: 'No zones found'
      });
    }

    // Find zone containing this state
    const zone = zones.find(z => 
      z.states.some((s: string) => 
        s.toLowerCase() === state.toLowerCase()
      )
    );

    if (!zone) {
      return res.status(404).json({
        success: false,
        error: `No zone found for state: ${state}`
      });
    }

    return res.status(200).json({
      success: true,
      data: zone
    });
  } catch (error) {
    console.error('Get zone error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}
