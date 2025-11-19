// Netlify Function: /api/stats
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL || '', SERVICE_KEY || '');

export async function handler(_event, _context) {
  try {
    // totals using head:true for counts
    const { count: ordersCount, error: ordersError } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true });

    if (ordersError) {
      console.error('Error fetching orders count:', ordersError);
    }

    const { count: hubsCount, error: hubsError } = await supabase
      .from('hubs')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true);

    if (hubsError) {
      console.error('Error fetching hubs count:', hubsError);
    }

    const { count: couriersCount, error: couriersError } = await supabase
      .from('couriers')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true);

    if (couriersError) {
      console.error('Error fetching couriers count:', couriersError);
    }

    const { data: zones, error: zonesError } = await supabase
      .from('zones')
      .select('estimated_delivery_days');

       if (zonesError) {
      console.error('Error fetching zones:', zonesError);
    }

    const avgDeliveryTime = zones && zones.length > 0
      ? zones.reduce((sum, z) => sum + (z.estimated_delivery_days || 0), 0) / zones.length
      : 0;

      const statsData = {
      totalOrders: ordersCount || 0,
      activeHubs: hubsCount || 0,
      activeCouriers: couriersCount || 0,
      avgDeliveryTime: Number(avgDeliveryTime.toFixed(1))
    };

    console.log('Stats data:', statsData);

    const body = JSON.stringify({
      success: true,
      data: statsData
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
    console.error('Stats function error:', e);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      },
      body: JSON.stringify({ success: false, error: 'Failed to fetch stats', details: e.message })
    };
  }
}
