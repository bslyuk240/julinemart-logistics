// Netlify Function: /api/stats
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL || '', SERVICE_KEY || '');

export async function handler(_event, _context) {
  try {
    // totals using head:true for counts
    const { count: ordersCount } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true });

    const { count: hubsCount } = await supabase
      .from('hubs')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true);

    const { count: couriersCount } = await supabase
      .from('couriers')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true);

    const { data: zones } = await supabase
      .from('zones')
      .select('estimated_delivery_days');

    const avgDeliveryTime = zones && zones.length > 0
      ? zones.reduce((sum, z) => sum + (z.estimated_delivery_days || 0), 0) / zones.length
      : 0;

    const body = JSON.stringify({
      success: true,
      data: {
        totalOrders: ordersCount || 0,
        activeHubs: hubsCount || 0,
        activeCouriers: couriersCount || 0,
        avgDeliveryTime: Number(avgDeliveryTime.toFixed(1))
      }
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      },
      body
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      },
      body: JSON.stringify({ success: false, error: 'Failed to fetch stats' })
    };
  }
}
