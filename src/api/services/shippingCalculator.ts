import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../types/supabase';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient<Database>(supabaseUrl, supabaseKey);

type ZoneRow = Database['public']['Tables']['zones']['Row'];
type CourierRow = Database['public']['Tables']['couriers']['Row'];
type RateRow = Database['public']['Tables']['shipping_rates']['Row'];
type MinimalCourier = Pick<CourierRow, 'id' | 'name' | 'average_delivery_time_days'>;

interface CartItem {
  productId: string;
  vendorId: string;
  quantity: number;
  weight: number; // kg
  hubId?: string;
}

interface ShippingCalculationRequest {
  deliveryState: string;
  deliveryCity: string;
  items: CartItem[];
  totalOrderValue: number;
}

interface DispatchGroupShipping {
  dispatchKey: string;      // "vendor:{id}" or "hub:{id}"
  dispatchLabel: string;    // display name
  courierId: string;
  courierName: string;
  items: CartItem[];
  totalWeight: number;
  baseRate: number;
  additionalWeightCharge: number;
  pickupSurcharge: number;
  subtotal: number;
  vat: number;
  totalShippingFee: number;
  deliveryTimelineDays: number;
}

interface ShippingCalculationResult {
  success: boolean;
  data?: {
    zoneName: string;
    zoneCode: string;
    dispatchGroups: DispatchGroupShipping[];
    rawShippingTotal: number;
    multiDiscountApplied: boolean;
    multiDiscountAmount: number;
    totalShippingFee: number;
    multiDispatchPoints: number;
    breakdown: string;
  };
  error?: string;
}

export async function calculateShipping(
  request: ShippingCalculationRequest
): Promise<ShippingCalculationResult> {
  try {
    const zone = await getZoneByState(request.deliveryState);
    if (!zone) {
      return { success: false, error: `No shipping zone found for state: ${request.deliveryState}` };
    }

    // Fetch all vendor rows for items in one query
    const vendorIds = [...new Set(request.items.map(i => i.vendorId))];
    const { data: vendorRows } = await supabase
      .from('vendors')
      .select('id, hub_id, fez_collection_method, address, city, state, approved_vendor_locations(zone_id, default_courier_id, vendor_pickup_surcharge)')
      .in('id', vendorIds);

    const vendorMap = new Map((vendorRows ?? []).map(v => [v.id, v]));

    // Fetch shipping_settings for multi-dispatch discount
    const { data: settingsRow } = await supabase
      .from('shipping_settings')
      .select('multi_dispatch_discount_pct, multi_dispatch_discount_cap, multi_dispatch_discount_active')
      .limit(1)
      .maybeSingle();

    // Group items by dispatch location key
    const groups = new Map<string, CartItem[]>();

    for (const item of request.items) {
      const vendor = vendorMap.get(item.vendorId);
      let dispatchKey: string;

      if (vendor?.fez_collection_method === 'fez_pickup') {
        dispatchKey = `vendor:${item.vendorId}`;
      } else {
        const hubId = item.hubId || vendor?.hub_id;
        dispatchKey = hubId ? `hub:${hubId}` : `hub:unknown`;
      }

      if (!groups.has(dispatchKey)) groups.set(dispatchKey, []);
      groups.get(dispatchKey)!.push(item);
    }

    const dispatchGroups: DispatchGroupShipping[] = [];

    for (const [dispatchKey, groupItems] of groups.entries()) {
      const [type, id] = dispatchKey.split(':');

      let shipping: DispatchGroupShipping | null = null;

      if (type === 'vendor') {
        const vendor = vendorMap.get(id);
        const loc = (vendor as any)?.approved_vendor_locations;
        const zoneId = loc?.zone_id || zone.id;
        const courierId = loc?.default_courier_id;
        const pickupSurcharge = Number(loc?.vendor_pickup_surcharge ?? 0);
        shipping = await calculateGroupShipping({
          dispatchKey,
          dispatchLabel: `Vendor (${vendor?.city || id})`,
          zoneId,
          courierId,
          hubId: null,
          items: groupItems,
          orderValue: request.totalOrderValue,
          pickupSurcharge,
        });
      } else {
        const hubId = id === 'unknown' ? null : id;
        shipping = await calculateGroupShipping({
          dispatchKey,
          dispatchLabel: hubId ? `Hub` : 'Default Hub',
          zoneId: zone.id,
          courierId: null,
          hubId,
          items: groupItems,
          orderValue: request.totalOrderValue,
          pickupSurcharge: 0,
        });
      }

      if (shipping) dispatchGroups.push(shipping);
    }

    if (dispatchGroups.length === 0) {
      return { success: false, error: 'Unable to calculate shipping for any dispatch point' };
    }

    const rawShippingTotal = dispatchGroups.reduce((sum, g) => sum + g.totalShippingFee, 0);
    const multiDispatchPoints = dispatchGroups.length;

    let multiDiscountApplied = false;
    let multiDiscountAmount = 0;

    if (
      multiDispatchPoints > 1 &&
      settingsRow?.multi_dispatch_discount_active &&
      (settingsRow?.multi_dispatch_discount_pct ?? 0) > 0
    ) {
      const pct = settingsRow.multi_dispatch_discount_pct!;
      const cap = settingsRow.multi_dispatch_discount_cap ?? null;
      multiDiscountAmount = rawShippingTotal * (pct / 100);
      if (cap && multiDiscountAmount > cap) multiDiscountAmount = cap;
      multiDiscountApplied = true;
    }

    const totalShippingFee = rawShippingTotal - multiDiscountAmount;

    const breakdown = dispatchGroups
      .map(g => `${g.dispatchLabel}: ${g.totalShippingFee.toLocaleString()}`)
      .join(', ');

    return {
      success: true,
      data: {
        zoneName: zone.name,
        zoneCode: zone.code,
        dispatchGroups,
        rawShippingTotal,
        multiDiscountApplied,
        multiDiscountAmount,
        totalShippingFee,
        multiDispatchPoints,
        breakdown,
      },
    };
  } catch (error) {
    console.error('Shipping calculation error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

async function calculateGroupShipping(opts: {
  dispatchKey: string;
  dispatchLabel: string;
  zoneId: string;
  courierId: string | null;
  hubId: string | null;
  items: CartItem[];
  orderValue: number;
  pickupSurcharge: number;
}): Promise<DispatchGroupShipping | null> {
  try {
    const { dispatchKey, dispatchLabel, zoneId, hubId, items, orderValue, pickupSurcharge } = opts;
    let courierId = opts.courierId;

    // Resolve hub label if hub-based
    let hubLabel = dispatchLabel;
    if (hubId) {
      const { data: hub } = await supabase.from('hubs').select('id, name').eq('id', hubId).single();
      if (!hub) return null;
      hubLabel = hub.name;
    }

    // Resolve courier
    let courier: MinimalCourier | null = null;
    if (courierId) {
      const { data: c } = await supabase
        .from('couriers')
        .select('id, name, average_delivery_time_days')
        .eq('id', courierId)
        .single();
      courier = c ?? null;
    }
    if (!courier && hubId) {
      courier = await getPrimaryCourier(hubId);
    }
    if (!courier) {
      const { data: anyCourier } = await supabase
        .from('couriers')
        .select('id, name, average_delivery_time_days')
        .eq('is_active', true)
        .limit(1)
        .single();
      courier = anyCourier ?? null;
    }
    if (!courier) return null;

    // Get rate
    const rate = await getShippingRate(hubId, zoneId, courier.id);
    if (!rate) return null;

    const totalWeight = items.reduce((sum, item) => sum + item.weight * item.quantity, 0);
    const baseRate = rate.flat_rate || 0;
    let additionalWeightCharge = 0;
    const baseWeightThreshold = rate.max_weight_kg || 4.0;
    if (totalWeight > baseWeightThreshold) {
      additionalWeightCharge = (totalWeight - baseWeightThreshold) * (rate.per_kg_rate || 0);
    }

    const subtotal = baseRate + additionalWeightCharge + pickupSurcharge;
    const vat = (subtotal * 7.5) / 100;
    const gross = subtotal + vat;

    const freeShippingThreshold = rate.free_shipping_threshold || 0;
    const totalShippingFee = freeShippingThreshold > 0 && orderValue >= freeShippingThreshold ? 0 : gross;

    return {
      dispatchKey,
      dispatchLabel: hubId ? hubLabel : dispatchLabel,
      courierId: courier.id,
      courierName: courier.name,
      items,
      totalWeight,
      baseRate,
      additionalWeightCharge,
      pickupSurcharge,
      subtotal,
      vat,
      totalShippingFee,
      deliveryTimelineDays: courier.average_delivery_time_days ?? 3,
    };
  } catch (error) {
    console.error('Group shipping calculation error:', error);
    return null;
  }
}

async function getZoneByState(state: string): Promise<ZoneRow | null> {
  const { data: zones } = await supabase.from('zones').select('*');
  if (!zones) return null;
  return zones.find(z => z.states.some((s: string) => s.toLowerCase() === state.toLowerCase())) ?? null;
}

async function getPrimaryCourier(hubId: string): Promise<MinimalCourier | null> {
  const { data: primaryLink } = await supabase
    .from('hub_couriers')
    .select('courier_id')
    .eq('hub_id', hubId)
    .eq('is_primary', true)
    .eq('is_active', true)
    .single();

  let courierId = primaryLink?.courier_id ?? undefined;

  if (!courierId) {
    const { data: anyLink } = await supabase
      .from('hub_couriers')
      .select('courier_id, priority')
      .eq('hub_id', hubId)
      .eq('is_active', true)
      .order('is_primary', { ascending: false })
      .order('priority', { ascending: false })
      .limit(1)
      .single();
    courierId = anyLink?.courier_id ?? undefined;
  }

  if (!courierId) return null;

  const { data: courier } = await supabase
    .from('couriers')
    .select('id, name, average_delivery_time_days')
    .eq('id', courierId)
    .single();
  return courier ?? null;
}

async function getShippingRate(
  hubId: string | null,
  destinationZoneId: string,
  courierId: string
): Promise<RateRow | null> {
  if (hubId) {
    const { data: exact } = await supabase
      .from('shipping_rates')
      .select('*')
      .eq('hub_id', hubId)
      .eq('zone_id', destinationZoneId)
      .eq('courier_id', courierId)
      .eq('is_active', true)
      .single();
    if (exact) return exact;

    const { data: hubZone } = await supabase
      .from('shipping_rates')
      .select('*')
      .eq('hub_id', hubId)
      .eq('zone_id', destinationZoneId)
      .eq('is_active', true)
      .limit(1)
      .single();
    if (hubZone) return hubZone;
  }

  // Zone-only fallback
  const { data: zoneRate } = await supabase
    .from('shipping_rates')
    .select('*')
    .eq('zone_id', destinationZoneId)
    .eq('is_active', true)
    .limit(1)
    .single();
  return zoneRate ?? null;
}

export type { ShippingCalculationRequest, ShippingCalculationResult, DispatchGroupShipping };
