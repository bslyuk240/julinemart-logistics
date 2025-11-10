// Netlify Function: /api/stats
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(supabaseUrl, serviceKey);

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
        'Access-Control-Allow-Origin': '*'
      },
      body
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ success: false, error: 'Failed to fetch stats' })
    };
  }
}

