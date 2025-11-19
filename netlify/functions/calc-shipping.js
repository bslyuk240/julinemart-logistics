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

    // Group items by hub
    const itemsByHub = {};
    for (const item of items) {
      const hubId = item.hubId || item.hub_id || 'default';
      if (!itemsByHub[hubId]) {
        itemsByHub[hubId] = [];
      }
      itemsByHub[hubId].push(item);
    }

    // Get hubs and couriers
    const { data: hubs } = await supabase
      .from('hubs')
      .select('id, name, city, state');

    const { data: couriers } = await supabase
      .from('couriers')
      .select('id, name, code');

    const normalizedState = state.toLowerCase();
    const defaultHub =
      hubs?.find((h) => h.state?.toLowerCase() === normalizedState) || hubs?.[0];

    const hubMap = new Map((hubs || []).map((h) => [h.id, h]));

    const hubIdResolution = {};
    Object.keys(itemsByHub).forEach((hubKey) => {
      let actualHubId = hubKey;
      if (hubKey === 'default') {
        actualHubId = defaultHub?.id || hubKey;
      }
      if (actualHubId && hubMap.has(actualHubId)) {
        hubIdResolution[hubKey] = actualHubId;
      }
    });

    // Get courier assignments for hubs
    const hubIds = Array.from(
      new Set(Object.values(hubIdResolution).filter((id) => Boolean(id)))
    );
    const hubCourierAssignments =
      hubIds.length > 0
        ? (
            await supabase
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

    // Calculate shipping for each hub
    const subOrders = [];
    let totalShippingFee = 0;

    for (const [hubId, hubItems] of Object.entries(itemsByHub)) {
      const actualHubId = hubIdResolution[hubId] || hubId;

      const hub = hubMap.get(actualHubId);
      if (!hub) {
        console.warn('Hub not found:', actualHubId);
        continue;
      }

      // Calculate weight for this hub
      const hubWeight = hubItems.reduce((sum, item) => {
        return sum + (Number(item.weight || 0) * Number(item.quantity || 1));
      }, 0);

      // Get shipping rate
      const { data: rates } = await supabase
        .from('shipping_rates')
        .select('*, couriers(id, name, code)')
        .eq('hub_id', actualHubId)
        .eq('zone_id', zone.id)
        .eq('is_active', true)
        .limit(1);

      const rate = rates && rates[0];
      if (!rate) {
        console.error('No rate found for hub:', actualHubId, 'zone:', zone.id);
        continue;
      }

      // ? FIXED: Calculate shipping WITHOUT VAT
      const baseRate = Number(rate.flat_rate || 0);
      const ratePerKg = Number(rate.per_kg_rate || 0);

      const additionalWeightCharge = hubWeight * ratePerKg;
      const totalShippingCost = baseRate + additionalWeightCharge; // NO VAT ADDED

      console.log('Hub calculation:', {
        hub: hub.name,
        baseRate,
        ratePerKg,
        weight: hubWeight,
        additionalCharge: additionalWeightCharge,
        total: totalShippingCost
      });

      // Get courier info
      const courier = rate.couriers || (couriers ? couriers[0] : null);
      const courierId =
        rate.courier_id ||
        hubCourierMap[actualHubId] ||
        courier?.id ||
        null;

      subOrders.push({
        hubId: actualHubId,
        hubName: hub.name,
        courierId,
        courierName: courier?.name || 'Standard Courier',
        totalWeight: Math.round(hubWeight * 100) / 100,
        baseRate: Math.round(baseRate * 100) / 100,
        additionalWeightCharge: Math.round(additionalWeightCharge * 100) / 100,
        subtotal: Math.round(totalShippingCost * 100) / 100,
        vat: 0, // Not adding VAT
        totalShippingFee: Math.round(totalShippingCost * 100) / 100,
        deliveryTimelineDays: 3,
        items: hubItems
      });

      totalShippingFee += totalShippingCost;
    }

    if (subOrders.length === 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Unable to calculate shipping for the given items'
        })
      };
    }

    const finalTotal = Math.round(totalShippingFee * 100) / 100;
    
    console.log('Final calculation:', {
      zone: zone.name,
      totalWeight,
      totalShippingFee: finalTotal
    });

    const response = {
      success: true,
      data: {
        zoneName: zone.name || zone.code,
        deliveryState: state,
        deliveryCity: city,
        totalWeight: Math.round(totalWeight * 100) / 100,
        totalShippingFee: finalTotal,
        subOrders: subOrders
      }
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
