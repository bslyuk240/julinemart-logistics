import type { Request, Response } from 'express';
import { supabaseServer as supabase } from '../../lib/supabaseServer';

export async function getSummaryHandler(_req: Request, res: Response) {
  try {
    const [ordersRes, hubsRes, couriersRes, zonesRes, ratesRes] = await Promise.all([
      supabase.from('orders').select('id', { count: 'exact', head: true }).limit(1),
      supabase.from('hubs').select('id', { count: 'exact', head: true }).eq('is_active', true).limit(1),
      supabase.from('couriers').select('id', { count: 'exact', head: true }).eq('is_active', true).limit(1),
      supabase.from('zones').select('estimated_delivery_days').neq('estimated_delivery_days', null).limit(1000),
      supabase
        .from('shipping_rates')
        .select('flat_rate, zones(name)')
        .eq('is_active', true)
        .order('priority', { ascending: false })
        .limit(4),
    ]);

    const totalOrders = ordersRes.count ?? 0;
    const activeHubs = hubsRes.count ?? 0;
    const activeCouriers = couriersRes.count ?? 0;

    const deliveryDays = (zonesRes.data ?? [])
      .map((z: { estimated_delivery_days: number | null }) => z.estimated_delivery_days)
      .filter((n): n is number => typeof n === 'number');
    const avgDeliveryTime = deliveryDays.length
      ? Number((deliveryDays.reduce((a, b) => a + b, 0) / deliveryDays.length).toFixed(1))
      : 0;

    const zonesPreview = (ratesRes.data ?? [])
      .map((r: any) => ({ name: r.zones?.name as string, flatRate: Number(r.flat_rate) }))
      .filter((z) => !!z.name && !Number.isNaN(z.flatRate));

    return res.status(200).json({
      success: true,
      data: { totalOrders, activeHubs, activeCouriers, avgDeliveryTime, zonesPreview },
    });
  } catch (error) {
    console.error('Summary error:', error);
    return res.status(500).json({
      error: 'Failed to load dashboard summary',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

