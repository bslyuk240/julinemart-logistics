// Netlify Function: /netlify/functions/calc-shipping.js
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL || '', SERVICE_KEY || '');

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

export async function handler(event) {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { 
      statusCode: 405, 
      headers, 
      body: JSON.stringify({ success: false, error: 'Method Not Allowed' }) 
    };
  }

  try {
    // Parse request body
    let payload;
    try {
      payload = JSON.parse(event.body || '{}');
    } catch (e) {
      return { 
        statusCode: 400, 
        headers, 
        body: JSON.stringify({ success: false, error: 'Invalid JSON body' }) 
      };
    }

    // Extract data (support multiple field names for compatibility)
    const state = payload.state || payload.deliveryState || payload.delivery_state || '';
    const city = payload.city || payload.deliveryCity || payload.delivery_city || '';
    const items = Array.isArray(payload.items) ? payload.items : [];
    const totalOrderValue = Number(payload.totalOrderValue || payload.total_order_value || 0);

    // Validate required fields
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

    // Calculate total weight from items
    const totalWeight = items.reduce((sum, item) => {
      const weight = Number(item.weight || 0);
      const quantity = Number(item.quantity || 1);
      return sum + (weight * quantity);
    }, 0);

    // Find zone for this state
    const { data: zones, error: zonesError } = await supabase
      .from('zones')
      .select('id, code, name, states');

    if (zonesError) {
      console.error('Zones fetch error:', zonesError);
      throw zonesError;
    }

    // Find matching zone
    let zone = null;
    if (zones && zones.length > 0) {
      zone = zones.find((z) => {
        if (Array.isArray(z.states)) {
          return z.states.some(s => s.toLowerCase() === state.toLowerCase());
        }
        return false;
      });
      
      // Fallback to first zone if no match
      if (!zone) {
        zone = zones[0];
      }
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

    // Group items by hub (if specified)
    const itemsByHub = {};
    for (const item of items) {
      const hubId = item.hubId || item.hub_id || 'default';
      if (!itemsByHub[hubId]) {
        itemsByHub[hubId] = [];
      }
      itemsByHub[hubId].push(item);
    }

    // Get all hubs
    const { data: hubs } = await supabase
      .from('hubs')
      .select('id, name, city, state');

    const hubMap = new Map((hubs || []).map(h => [h.id, h]));

    // Calculate shipping for each hub
    let totalShippingCost = 0;
    let totalVat = 0;
    const shipments = [];

    for (const [hubId, hubItems] of Object.entries(itemsByHub)) {
      // Determine actual hub ID
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

      // Get shipping rate for this hub -> zone
      const { data: rates, error: ratesError } = await supabase
        .from('shipping_rates')
        .select('base_rate, rate_per_kg, vat_percentage')
        .eq('hub_id', actualHubId)
        .eq('zone_id', zone.id)
        .limit(1);

      if (ratesError) {
        console.error('Rates fetch error:', ratesError);
        continue;
      }

      // Use rate or fallback
      const rate = rates && rates[0] ? rates[0] : { 
        base_rate: 2500, 
        rate_per_kg: 500, 
        vat_percentage: 7.5 
      };

      const baseRate = Number(rate.base_rate || 0);
      const ratePerKg = Number(rate.rate_per_kg || 0);
      const vatPercentage = Number(rate.vat_percentage || 7.5);

      const shippingCost = baseRate + (hubWeight * ratePerKg);
      const vatAmount = shippingCost * (vatPercentage / 100);
      const totalCost = shippingCost + vatAmount;

      shipments.push({
        hubId: actualHubId,
        hubName: hub.name,
        items: hubItems.length,
        totalWeight: hubWeight,
        shippingCost: Math.round(shippingCost * 100) / 100,
        vatAmount: Math.round(vatAmount * 100) / 100,
        totalCost: Math.round(totalCost * 100) / 100,
      });

      totalShippingCost += totalCost;
      totalVat += vatAmount;
    }

    // If no valid shipments, return fallback
    if (shipments.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          total_shipping_cost: 3500, // Fallback cost
          total_vat: 262.5,
          zone_name: zone.name || zone.code,
          delivery_state: state,
          delivery_city: city,
          shipments: [],
          currency: 'NGN',
          fallback: true,
        })
      };
    }

    // Return successful response in format WordPress plugin expects
    const response = {
      success: true,
      total_shipping_cost: Math.round(totalShippingCost * 100) / 100,
      total_vat: Math.round(totalVat * 100) / 100,
      zone_name: zone.name || zone.code,
      delivery_state: state,
      delivery_city: city,
      total_weight: totalWeight,
      shipments,
      currency: 'NGN',
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
}
