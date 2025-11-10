import { createClient } from '@supabase/supabase-js';
import type { Database } from '../types/supabase';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase credentials. Check .env.local file.');
}

const supabase = createClient<Database>(supabaseUrl, supabaseKey);

export interface ShippingCalculationInput {
  deliveryState: string;
  deliveryCity: string;
  items: Array<{
    productId: string;
    quantity: number;
    weight?: number;
    hubId?: string;
  }>;
  totalOrderValue: number;
}

export interface ShippingCalculationResult {
  totalShippingFee: number;
  zoneId: string;
  zoneName: string;
  estimatedDeliveryDays: number;
  breakdown: Array<{
    hubId: string;
    hubName: string;
    shippingCost: number;
    items: number;
  }>;
}

export async function calculateShipping(
  input: ShippingCalculationInput
): Promise<ShippingCalculationResult> {
  try {
    const { data: zone, error: zoneError } = await supabase
      .from('zones')
      .select('*')
      .contains('states', [input.deliveryState])
      .single();

    if (zoneError || !zone) {
      throw new Error(`Zone not found for state: ${input.deliveryState}`);
    }

    const itemsByHub = new Map<string, typeof input.items>();
    for (const item of input.items) {
      const hubId = item.hubId || 'default-hub';
      if (!itemsByHub.has(hubId)) {
        itemsByHub.set(hubId, []);
      }
      itemsByHub.get(hubId)!.push(item);
    }

    const breakdown = await Promise.all(
      Array.from(itemsByHub.entries()).map(async ([hubId, hubItems]) => {
        const { data: hub } = await supabase
          .from('hubs')
          .select('name')
          .eq('id', hubId)
          .single();

        const { data: rate } = await supabase
          .from('shipping_rates')
          .select('flat_rate, per_kg_rate, free_shipping_threshold')
          .eq('zone_id', zone.id)
          .eq('is_active', true)
          .order('priority', { ascending: false })
          .limit(1)
          .single();

        if (!rate) {
          throw new Error(`No shipping rate found for zone: ${zone.name}`);
        }

        const totalWeight = hubItems.reduce(
          (sum, item) => sum + (item.weight || 0) * item.quantity,
          0
        );

        let shippingCost = rate.flat_rate;
        if (rate.per_kg_rate && totalWeight > 0) {
          shippingCost += rate.per_kg_rate * totalWeight;
        }

        if (
          rate.free_shipping_threshold &&
          input.totalOrderValue >= rate.free_shipping_threshold
        ) {
          shippingCost = 0;
        }

        return {
          hubId,
          hubName: hub?.name || 'Unknown Hub',
          shippingCost: Number(shippingCost.toFixed(2)),
          items: hubItems.length,
        };
      })
    );

    const totalShippingFee = breakdown.reduce(
      (sum, item) => sum + item.shippingCost,
      0
    );

    return {
      totalShippingFee: Number(totalShippingFee.toFixed(2)),
      zoneId: zone.id,
      zoneName: zone.name,
      estimatedDeliveryDays: zone.estimated_delivery_days || 3,
      breakdown,
    };
  } catch (error) {
    console.error('Error calculating shipping:', error);
    throw error;
  }
}

export async function getAvailableZones() {
  const { data: zones, error } = await supabase
    .from('zones')
    .select('*, shipping_rates(flat_rate, free_shipping_threshold)')
    .order('name');

  if (error) throw error;
  return zones;
}

export async function getZoneByState(state: string) {
  const { data: zone, error } = await supabase
    .from('zones')
    .select('*')
    .contains('states', [state])
    .single();

  if (error) throw error;
  return zone;
}