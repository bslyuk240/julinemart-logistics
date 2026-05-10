// FIXED VERSION - netlify/functions/calc-shipping.js
// KEY FIX: Removed VAT calculation to prevent double-charging

import { createClient } from '@supabase/supabase-js';
const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

/**
 * Apply the best available shipping discount for this request.
 * Fail-safe: returns originalShipping on any issue.
 */
async function applyDiscounts({ originalShipping, orderValue, deliveryState, supabase }) {
  try {
    const { data, error } = await supabase
      .from('shipping_discounts')
      .select('*')
      .eq('is_active', true);

    if (error || !data || data.length === 0) {
      if (error) {
        console.error('applyDiscounts query failed, returning original shipping:', error.message || error);
      }
      return originalShipping;
    }

    const now = new Date();
    const normalizedState = (deliveryState || '').toLowerCase();
    let bestShipping = originalShipping;

    for (const discount of data) {
      // Date window
      if (discount.start_date && new Date(discount.start_date) > now) continue;
      if (discount.end_date && new Date(discount.end_date) < now) continue;

      // Minimum order value
      const minOrder = Number(discount.min_order_value ?? 0);
      if (orderValue < minOrder) continue;

      // State filter
      if (Array.isArray(discount.states) && discount.states.length > 0) {
        const applies = discount.states.some(
          (s) => (s || '').toLowerCase() === normalizedState
        );
        if (!applies) continue;
      }

      const type = (discount.type || '').toLowerCase();
      const value = Number(discount.discount_value ?? 0);
      if (!type) continue;

      let candidate = originalShipping;
      if (type === 'free') {
        candidate = 0;
      } else if (type === 'flat') {
        if (!Number.isFinite(value) || value <= 0) continue;
        candidate = Math.max(0, originalShipping - value);
      } else if (type === 'percent') {
        if (!Number.isFinite(value) || value <= 0) continue;
        candidate = Math.max(0, originalShipping - (originalShipping * (value / 100)));
      } else {
        continue;
      }

      if (candidate < bestShipping) {
        bestShipping = candidate;
      }
    }

    return bestShipping;
  } catch (err) {
    console.error('applyDiscounts failed, returning original shipping:', err?.message || err);
    return originalShipping;
  }
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ success: false, error: 'Method not allowed' })
    };
  }

  try {
    const payload = JSON.parse(event.body || '{}');
    const state = payload.deliveryState || payload.delivery_state || '';
    const city = payload.deliveryCity || payload.delivery_city || '';
    const items = Array.isArray(payload.items) ? payload.items : [];
    const itemsValue = items.reduce((sum, item) => {
      return sum + (Number(item.price || 0) * Number(item.quantity || 1));
    }, 0);
    const providedOrderValue = Number(
      payload.orderValue ??
      payload.order_value ??
      payload.orderTotal ??
      payload.order_total ??
      payload.totalOrderValue ??
      payload.total_order_value ??
      payload.total ??
      payload.subtotal ??
      payload.cartTotal ??
      payload.cart_total ??
      payload.grandTotal ??
      payload.grand_total ??
      0
    );
    const totalOrderValue =
      Number.isFinite(providedOrderValue) && providedOrderValue > 0
        ? providedOrderValue
        : itemsValue;

    console.log('Calc shipping request:', { state, city, itemCount: items.length });

    if (!state || items.length === 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          success: false, 
          error: 'Missing required fields: deliveryState and items are required' 
        })
      };
    }

    // Calculate total weight
    const totalWeight = items.reduce((sum, item) => {
      const weight = Number(item.weight || 0);
      const quantity = Number(item.quantity || 1);
      return sum + (weight * quantity);
    }, 0);

    console.log('Total weight:', totalWeight);

    // Find zone
    const { data: zones, error: zonesError } = await supabase
      .from('zones')
      .select('id, code, name, states');

    if (zonesError) throw zonesError;

    let zone = null;
    if (zones && zones.length > 0) {
      zone = zones.find((z) => {
        if (Array.isArray(z.states)) {
          return z.states.some(s => s.toLowerCase() === state.toLowerCase());
        }
        return false;
      });
      if (!zone) zone = zones[0];
    }

    if (!zone) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ 
          success: false, 
          error: `No delivery zone found for ${state}` 
        })
      };
    }

    console.log('Zone found:', zone.name);

    // ── Fetch hubs, couriers, and shipping settings ──────────────────────────
    const { data: hubs } = await supabase.from('hubs').select('id, name, city, state');
    const { data: couriers } = await supabase.from('couriers').select('id, name, code');
    const { data: shippingSettings } = await supabase
      .from('shipping_settings')
      .select('multi_dispatch_discount_pct, multi_dispatch_discount_cap, multi_dispatch_discount_active')
      .eq('id', 1)
      .single();

    const normalizedState = state.toLowerCase();
    const defaultHub =
      hubs?.find((h) => h.state?.toLowerCase() === normalizedState) || hubs?.[0];
    const hubMap = new Map((hubs || []).map((h) => [h.id, h]));

    // ── Resolve vendor fez_collection_method for items that carry vendorId ───
    // Items may optionally carry vendorId to enable vendor-direct dispatch routing.
    const vendorIds = [...new Set(items.map((i) => i.vendorId || i.vendor_id).filter(Boolean))];
    const vendorMap = new Map();
    if (vendorIds.length > 0) {
      const { data: vendorRows } = await supabase
        .from('vendors')
        .select(`
          id, fez_collection_method, address, city, state, hub_id,
          approved_vendor_locations ( id, zone_id, default_courier_id, vendor_pickup_surcharge )
        `)
        .in('id', vendorIds);
      (vendorRows || []).forEach((v) => vendorMap.set(v.id, v));
    }

    // ── Group items by DISPATCH LOCATION ─────────────────────────────────────
    // Dispatch location key:
    //   vendor-direct (fez_pickup) → "vendor:{vendorId}"
    //   hub-based (or hub_dropoff) → "hub:{hubId}"
    // Items from the same dispatch location are merged (one Fez pickup).
    const itemsByDispatch = {};

    for (const item of items) {
      const vendorId = item.vendorId || item.vendor_id;
      const vendor   = vendorId ? vendorMap.get(vendorId) : null;

      let dispatchKey;
      let dispatchMeta;

      if (vendor?.fez_collection_method === 'fez_pickup') {
        dispatchKey  = `vendor:${vendorId}`;
        dispatchMeta = { type: 'vendor_direct', vendor, vendorId };
      } else {
        const rawHubId  = item.hubId || item.hub_id || 'default';
        const actualHub = rawHubId === 'default'
          ? defaultHub?.id
          : (hubMap.has(rawHubId) ? rawHubId : defaultHub?.id);
        dispatchKey  = `hub:${actualHub || 'default'}`;
        dispatchMeta = { type: 'hub', hubId: actualHub, vendor };
      }

      if (!itemsByDispatch[dispatchKey]) {
        itemsByDispatch[dispatchKey] = { meta: dispatchMeta, items: [] };
      }
      itemsByDispatch[dispatchKey].items.push(item);
    }

    // ── Get courier assignments for hub-based dispatch points ─────────────────
    const hubIds = [...new Set(
      Object.values(itemsByDispatch)
        .filter((g) => g.meta.type === 'hub' && g.meta.hubId)
        .map((g) => g.meta.hubId)
    )];
    const hubCourierAssignments = hubIds.length > 0
      ? (await supabase
          .from('hub_couriers')
          .select('hub_id, courier_id')
          .in('hub_id', hubIds)
          .order('is_primary', { ascending: false })
          .order('priority', { ascending: false })
        ).data
      : [];
    const hubCourierMap = {};
    (hubCourierAssignments || []).forEach((row) => {
      if (row?.hub_id && row?.courier_id && !hubCourierMap[row.hub_id]) {
        hubCourierMap[row.hub_id] = row.courier_id;
      }
    });

    // ── Calculate shipping cost per dispatch location ─────────────────────────
    const dispatchGroups = [];

    for (const [dispatchKey, group] of Object.entries(itemsByDispatch)) {
      const { meta, items: groupItems } = group;
      const groupWeight = groupItems.reduce(
        (sum, i) => sum + (Number(i.weight || 0) * Number(i.quantity || 1)), 0
      );

      let rate = null;
      let pickupSurcharge = 0;
      let resolvedZoneId = zone.id;
      let courierId = null;
      let courierName = 'Standard Courier';
      let hubName = null;

      if (meta.type === 'vendor_direct') {
        // Use vendor's approved location zone + default courier for rate lookup
        const loc = meta.vendor?.approved_vendor_locations;
        if (loc?.zone_id) resolvedZoneId = loc.zone_id;
        if (loc?.default_courier_id) courierId = loc.default_courier_id;
        pickupSurcharge = Number(loc?.vendor_pickup_surcharge || 0);
        hubName = `${meta.vendor?.city || ''} (Vendor Direct)`;

        // Rate lookup by zone + courier for vendor-direct
        const { data: vendorRates } = await supabase
          .from('shipping_rates')
          .select('*, couriers(id, name, code)')
          .eq('zone_id', resolvedZoneId)
          .eq('is_active', true)
          .order('priority', { ascending: false })
          .limit(1);
        rate = vendorRates?.[0] || null;
      } else {
        // Hub-based dispatch
        const actualHubId = meta.hubId;
        const hub = hubMap.get(actualHubId);
        hubName = hub?.name || 'JulineMart Hub';

        const { data: hubRates } = await supabase
          .from('shipping_rates')
          .select('*, couriers(id, name, code)')
          .eq('hub_id', actualHubId)
          .eq('zone_id', zone.id)
          .eq('is_active', true)
          .limit(1);
        rate = hubRates?.[0] || null;

        if (!rate) {
          const { data: fallbackRates } = await supabase
            .from('shipping_rates')
            .select('*, couriers(id, name, code)')
            .eq('zone_id', zone.id)
            .eq('is_active', true)
            .limit(1);
          rate = fallbackRates?.[0] || null;
        }

        courierId = rate?.courier_id || hubCourierMap[actualHubId] || null;
      }

      if (!rate) {
        console.error('No rate found for dispatch:', dispatchKey);
        continue;
      }

      const baseRate  = Number(rate.flat_rate || 0);
      const perKgRate = Number(rate.per_kg_rate || 0);
      const dispatchCost = baseRate + (groupWeight * perKgRate) + pickupSurcharge;

      const resolvedCourier = rate.couriers || couriers?.[0] || null;
      courierName = resolvedCourier?.name || courierName;
      if (!courierId) courierId = resolvedCourier?.id || null;

      dispatchGroups.push({
        dispatchKey,
        dispatchType:     meta.type,
        hubName,
        courierId,
        courierName,
        totalWeight:      Math.round(groupWeight * 100) / 100,
        baseRate:         Math.round(baseRate * 100) / 100,
        pickupSurcharge:  Math.round(pickupSurcharge * 100) / 100,
        subtotal:         Math.round(dispatchCost * 100) / 100,
        totalShippingFee: Math.round(dispatchCost * 100) / 100,
        vat: 0,
        deliveryTimelineDays: 3,
        items: groupItems,
      });
    }

    if (dispatchGroups.length === 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'Unable to calculate shipping for the given items' }),
      };
    }

    // ── Multi-dispatch discount logic ─────────────────────────────────────────
    // Single dispatch location → full price, no discount.
    // Multiple dispatch locations → sum all, apply configurable discount on total.
    const rawTotal = dispatchGroups.reduce((sum, g) => sum + g.subtotal, 0);
    let finalTotal = rawTotal;
    let multiDiscountApplied = 0;

    if (
      dispatchGroups.length > 1 &&
      shippingSettings?.multi_dispatch_discount_active &&
      Number(shippingSettings.multi_dispatch_discount_pct) > 0
    ) {
      const pct = Number(shippingSettings.multi_dispatch_discount_pct);
      const cap = Number(shippingSettings.multi_dispatch_discount_cap || 0);
      let discount = rawTotal * (pct / 100);
      if (cap > 0) discount = Math.min(discount, cap);
      multiDiscountApplied = Math.round(discount * 100) / 100;
      finalTotal = rawTotal - multiDiscountApplied;
    }

    const discountedTotal = await applyDiscounts({
      originalShipping: finalTotal,
      orderValue: totalOrderValue,
      deliveryState: state,
      supabase,
    });
    const finalShippingFee = Math.round(discountedTotal * 100) / 100;

    console.log('Final calculation:', {
      zone: zone.name,
      dispatchPoints: dispatchGroups.length,
      rawTotal,
      multiDiscountApplied,
      finalShippingFee,
    });

    const response = {
      success: true,
      data: {
        zoneName:           zone.name || zone.code,
        deliveryState:      state,
        deliveryCity:       city,
        totalWeight:        Math.round(totalWeight * 100) / 100,
        totalShippingFee:   finalShippingFee,
        rawShippingTotal:   Math.round(rawTotal * 100) / 100,
        multiDiscountApplied,
        multiDispatchPoints: dispatchGroups.length,
        subOrders:          dispatchGroups,
      },
    };

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(response)
    };

  } catch (error) {
    console.error('calc-shipping error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        success: false, 
        error: 'Failed to calculate shipping',
        message: error.message 
      })
    };
  }
};
