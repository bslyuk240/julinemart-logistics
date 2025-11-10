import type { Request, Response } from 'express';
import { supabaseServer as supabase } from '../../lib/supabaseServer';

export async function getHubsHandler(_req: Request, res: Response) {
  try {
    const { data, error } = await supabase
      .from('hubs')
      .select('id, name, code, city, state, phone, manager_name, is_active')
      .order('name');

    if (error) throw error;

    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('Get hubs error:', error);
    return res.status(500).json({
      error: 'Failed to fetch hubs',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

