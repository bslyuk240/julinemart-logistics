import type { Request, Response } from 'express';
import { supabaseServer as supabase } from '../../lib/supabaseServer';

export async function getCouriersHandler(_req: Request, res: Response) {
  try {
    const { data, error } = await supabase
      .from('couriers')
      .select('id, name, code, type, is_active, base_rate, success_rate')
      .order('name');

    if (error) throw error;

    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('Get couriers error:', error);
    return res.status(500).json({
      error: 'Failed to fetch couriers',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

