import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../types/supabase';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

interface CartItem {
  productId: string;
  vendorId: string;
  quantity: number;
  weight: number; // in kg
  hubId?: string; // Optional: can be determined from vendor
}

interface ShippingCalculationRequest {
  deliveryState: string;
  deliveryCity: string;
  items: CartItem[];
  totalOrderValue: number;
}

interface SubOrderShipping {
  hubId: string;
  hubName: string;
  courierId: string;
  courierName: string;
  items: CartItem[];
  totalWeight: number;
  baseRate: number;
  additionalWeightCharge: number;
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
    subOrders: SubOrderShipping[];
    totalShippingFee: number;
    breakdown: string;
  };
  error?: string;
}

/**
 * Main shipping calculation function
 * Handles multi-hub order splitting and rate calculation
 */
export async function calculateShipping(
  request: ShippingCalculationRequest
): Promise<ShippingCalculationResult> {
  try {
    // Step 1: Determine destination zone
    const zone = await getZoneByState(request.deliveryState);
    if (!zone) {
      return {
        success: false,
        error: `No shipping zone found for state: ${request.deliveryState}`
      };
    }

    // Step 2: Group items by hub
    const itemsByHub = await groupItemsByHub(request.items);
    
    // Step 3: Calculate shipping for each hub
    const subOrderShippings: SubOrderShipping[] = [];
    
    for (const [hubId, hubItems] of Object.entries(itemsByHub)) {
      const shipping = await calculateHubShipping(
        hubId,
        zone.id,
        hubItems,
        request.totalOrderValue
      );
      
      if (shipping) {
        subOrderShippings.push(shipping);
      }
    }

    if (subOrderShippings.length === 0) {
      return {
        success: false,
        error: 'Unable to calculate shipping for any hub'
      };
    }

    // Step 4: Calculate totals
    const totalShippingFee = subOrderShippings.reduce(
      (sum, sub) => sum + sub.totalShippingFee,
      0
    );

    const breakdown = subOrderShippings
      .map(sub => `${sub.hubName}: ${sub.totalShippingFee.toLocaleString()}`)
      .join(', ');

    return {
      success: true,
      data: {
        zoneName: zone.name,
        zoneCode: zone.code,
        subOrders: subOrderShippings,
        totalShippingFee,
        breakdown
      }
    };
  } catch (error) {
    console.error('Shipping calculation error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Get zone by state name
 */
async function getZoneByState(state: string): Promise<any | null> {
  const { data: zones } = await supabase
    .from('zones')
    .select('*');

  if (!zones) return null;

  // Find zone that contains this state
  const zone = zones.find(z => 
    z.states.some((s: string) => 
      s.toLowerCase() === state.toLowerCase()
    )
  );

  return zone || null;
}

/**
 * Group cart items by their fulfillment hub
 */
async function groupItemsByHub(items: CartItem[]): Promise<Record<string, CartItem[]>> {
  const itemsByHub: Record<string, CartItem[]> = {};

  for (const item of items) {
    let hubId = item.hubId;

    // If hub not specified, get it from vendor
    if (!hubId && item.vendorId) {
      const { data: vendor } = await supabase
        .from('vendors')
        .select('primary_hub_id')
        .eq('id', item.vendorId)
        .single();

      hubId = vendor?.primary_hub_id;
    }

    // Fallback to default hub if still not found
    if (!hubId) {
      const { data: defaultHub } = await supabase
        .from('hubs')
        .select('id')
        .eq('is_active', true)
        .limit(1)
        .single();

      hubId = defaultHub?.id;
    }

    if (hubId) {
      if (!itemsByHub[hubId]) {
        itemsByHub[hubId] = [];
      }
      itemsByHub[hubId].push(item);
    }
  }

  return itemsByHub;
}

/**
 * Calculate shipping for items from a specific hub
 */
async function calculateHubShipping(
  hubId: string,
  destinationZoneId: string,
  items: CartItem[],
  orderValue: number
): Promise<SubOrderShipping | null> {
  try {
    // Get hub details
    const { data: hub } = await supabase
      .from('hubs')
      .select('id, name, code')
      .eq('id', hubId)
      .single();

    if (!hub) return null;

    // Get primary courier for this hub
    const courier = await getPrimaryCourier(hubId);
    if (!courier) {
      console.warn(`No courier found for hub: ${hub.name}`);
      return null;
    }

    // Get shipping rate for this hub  zone  courier combination
    const rate = await getShippingRate(hubId, destinationZoneId, courier.id);
    if (!rate) {
      console.warn(`No rate found for ${hub.name}  Zone ${destinationZoneId} via ${courier.name}`);
      return null;
    }

    // Calculate total weight
    const totalWeight = items.reduce((sum, item) => sum + (item.weight * item.quantity), 0);

    // Calculate costs
    let baseRate = rate.flat_rate || rate.base_rate || 0;
    let additionalWeightCharge = 0;

    // If weight exceeds the base weight threshold, add extra charges
    const baseWeightThreshold = rate.max_weight_kg || 4.0;
    if (totalWeight > baseWeightThreshold) {
      const extraWeight = totalWeight - baseWeightThreshold;
      const additionalRate = rate.per_kg_rate || 0;
      additionalWeightCharge = extraWeight * additionalRate;
    }

    const subtotal = baseRate + additionalWeightCharge;
    // Our schema does not store VAT per rate; apply a default 7.5%
    const vatPercentage = 7.5;
    const vat = (subtotal * vatPercentage) / 100;
    const totalShippingFee = subtotal + vat;

    // Check for free shipping threshold
    const freeShippingThreshold = rate.free_shipping_threshold || 0;
    const finalShippingFee = orderValue >= freeShippingThreshold ? 0 : totalShippingFee;

    return {
      hubId: hub.id,
      hubName: hub.name,
      courierId: courier.id,
      courierName: courier.name,
      items,
      totalWeight,
      baseRate,
      additionalWeightCharge,
      subtotal,
      vat,
      totalShippingFee: finalShippingFee,
      deliveryTimelineDays: rate.delivery_timeline_days || 3
    };
  } catch (error) {
    console.error('Hub shipping calculation error:', error);
    return null;
  }
}

/**
 * Get primary courier for a hub (or fallback to available courier)
 */
async function getPrimaryCourier(hubId: string): Promise<any | null> {
  // First: fetch courier_id from hub_couriers to avoid relationship naming issues
  const { data: primaryLink } = await supabase
    .from('hub_couriers')
    .select('courier_id')
    .eq('hub_id', hubId)
    .eq('is_primary', true)
    .eq('is_active', true)
    .single();

  let courierId = primaryLink?.courier_id as string | undefined;

  if (!courierId) {
    // Fallback: any active courier for this hub (highest priority first)
    const { data: anyLink } = await supabase
      .from('hub_couriers')
      .select('courier_id, priority')
      .eq('hub_id', hubId)
      .eq('is_active', true)
      .order('is_primary', { ascending: false })
      .order('priority', { ascending: false })
      .limit(1)
      .single();
    courierId = anyLink?.courier_id as string | undefined;
  }

  if (!courierId) {
    // Final fallback: any active courier globally
    const { data: anyCourier } = await supabase
      .from('couriers')
      .select('id, name')
      .eq('is_active', true)
      .limit(1)
      .single();
    if (!anyCourier) return null;
    return anyCourier;
  }

  const { data: courier } = await supabase
    .from('couriers')
    .select('id, name')
    .eq('id', courierId)
    .single();
  return courier || null;
}

/**
 * Get shipping rate for specific hub / zone / courier combination
 */
async function getShippingRate(
  originHubId: string,
  destinationZoneId: string,
  courierId: string
): Promise<any | null> {
  // Try exact match first (schema: hub_id, zone_id, courier_id)
  const { data: exactRate } = await supabase
    .from('shipping_rates')
    .select('*')
    .eq('hub_id', originHubId)
    .eq('zone_id', destinationZoneId)
    .eq('courier_id', courierId)
    .eq('is_active', true)
    .single();

  if (exactRate) return exactRate;

  // Fallback 1: Same hub and zone, any courier
  const { data: hubZoneRate } = await supabase
    .from('shipping_rates')
    .select('*')
    .eq('hub_id', originHubId)
    .eq('zone_id', destinationZoneId)
    .eq('is_active', true)
    .limit(1)
    .single();

  if (hubZoneRate) return hubZoneRate;

  // Fallback 2: Just zone-based rate (any hub, any courier)
  const { data: zoneRate } = await supabase
    .from('shipping_rates')
    .select('*')
    .eq('zone_id', destinationZoneId)
    .eq('is_active', true)
    .limit(1)
    .single();

  return zoneRate || null;
}

export type { ShippingCalculationRequest, ShippingCalculationResult, SubOrderShipping };
