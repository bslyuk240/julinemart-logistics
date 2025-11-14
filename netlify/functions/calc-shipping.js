// FIXED VERSION - netlify/functions/calc-shipping.js
// Key changes:
// 1. rate.base_rate → rate.flat_rate
// 2. rate.rate_per_kg → rate.per_kg_rate

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

exports.handler = async (event) => {
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

    const hubMap = new Map((hubs || []).map(h => [h.id, h]));

    // Calculate shipping for each hub
    const subOrders = [];
    let totalShippingFee = 0;

    for (const [hubId, hubItems] of Object.entries(itemsByHub)) {
      let actualHubId = hubId;
      
      if (hubId === 'default') {
        const defaultHub = hubs?.find(h => 
          h.state?.toLowerCase() === state.toLowerCase()
        ) || hubs?.[0];
        actualHubId = defaultHub?.id || '';
      }

      const hub = hubMap.get(actualHubId);
      if (!hub) continue;

      // Calculate weight for this hub
      const hubWeight = hubItems.reduce((sum, item) => {
        return sum + (Number(item.weight || 0) * Number(item.quantity || 1));
      }, 0);

      // ✅ FIXED: Get shipping rate with CORRECT field names
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

      // ✅ FIXED: Use flat_rate and per_kg_rate instead of base_rate and rate_per_kg
      const baseRate = Number(rate.flat_rate || 0);
      const ratePerKg = Number(rate.per_kg_rate || 0);
      const vatPercentage = 7.5; // Default VAT percentage

      const additionalWeightCharge = hubWeight * ratePerKg;
      const subtotal = baseRate + additionalWeightCharge;
      const vat = subtotal * (vatPercentage / 100);
      const totalShippingCost = subtotal + vat;

      // Get courier info
      const courier = rate.couriers || (couriers ? couriers[0] : null);

      subOrders.push({
        hubId: actualHubId,
        hubName: hub.name,
        courierId: courier?.id || '',
        courierName: courier?.name || 'Standard Courier',
        totalWeight: Math.round(hubWeight * 100) / 100,
        baseRate: Math.round(baseRate * 100) / 100,
        additionalWeightCharge: Math.round(additionalWeightCharge * 100) / 100,
        subtotal: Math.round(subtotal * 100) / 100,
        vat: Math.round(vat * 100) / 100,
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

    const response = {
      success: true,
      data: {
        zoneName: zone.name || zone.code,
        deliveryState: state,
        deliveryCity: city,
        totalWeight: Math.round(totalWeight * 100) / 100,
        totalShippingFee: Math.round(totalShippingFee * 100) / 100,
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
