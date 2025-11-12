// Netlify Function: /netlify/functions/calc-shipping.js
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL || '', SERVICE_KEY || '');

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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
      body: JSON.stringify({ success: false, error: 'Method Not Allowed' }),
    };
  }

  try {
    // 🔹 Step 1: Parse body safely regardless of Content-Type
    let payload = {};
    try {
      const contentType = event.headers['content-type'] || '';
      if (contentType.includes('application/json')) {
        payload = JSON.parse(event.body || '{}');
      } else if (contentType.includes('application/x-www-form-urlencoded')) {
        const params = new URLSearchParams(event.body);
        payload = Object.fromEntries(params.entries());
      } else {
        // fallback for WooCommerce webhook format or missing headers
        try {
          payload = JSON.parse(event.body || '{}');
        } catch {
          payload = event.body ? { raw: event.body } : {};
        }
      }
    } catch (parseError) {
      console.error('Body parse error:', parseError);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'Invalid request body' }),
      };
    }

    // 🔹 Step 2: Extract expected fields
    const state =
      payload.state || payload.deliveryState || payload.delivery_state || '';
    const city =
      payload.city || payload.deliveryCity || payload.delivery_city || '';
    const items = Array.isArray(payload.items)
      ? payload.items
      : typeof payload.items === 'string'
        ? JSON.parse(payload.items)
        : [];
    const totalOrderValue = Number(
      payload.totalOrderValue || payload.total_order_value || 0
    );

    // 🔹 Step 3: Validate inputs
    if (!state || items.length === 0) {
      console.warn('Validation failed: Missing fields', payload);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error:
            'Missing required fields: deliveryState and items are required',
        }),
      };
    }

    // 🔹 Step 4: Calculate total weight
    const totalWeight = items.reduce((sum, item) => {
      const weight = Number(item.weight || 0);
      const quantity = Number(item.quantity || 1);
      return sum + weight * quantity;
    }, 0);

    // 🔹 Step 5: Get zones
    const { data: zones, error: zonesError } = await supabase
      .from('zones')
      .select('id, code, name, states');

    if (zonesError) throw zonesError;

    // 🔹 Step 6: Find zone for state
    let zone = zones?.find(
      z =>
        Array.isArray(z.states) &&
        z.states.some(s => s.toLowerCase() === state.toLowerCase())
    );
    if (!zone && zones?.length) zone = zones[0];

    if (!zone) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({
          success: false,
          error: `No delivery zone found for ${state}`,
        }),
      };
    }

    // 🔹 Step 7: Group items by hub
    const itemsByHub = {};
    for (const item of items) {
      const hubId = item.hubId || item.hub_id || 'default';
      if (!itemsByHub[hubId]) itemsByHub[hubId] = [];
      itemsByHub[hubId].push(item);
    }

    const { data: hubs } = await supabase
      .from('hubs')
      .select('id, name, city, state');

    const hubMap = new Map((hubs || []).map(h => [h.id, h]));

    // 🔹 Step 8: Calculate shipping per hub
    let totalShippingCost = 0;
    let totalVat = 0;
    const shipments = [];

    for (const [hubId, hubItems] of Object.entries(itemsByHub)) {
      let actualHubId = hubId;
      if (hubId === 'default') {
        const defaultHub =
          hubs?.find(h => h.state?.toLowerCase() === state.toLowerCase()) ||
          hubs?.[0];
        actualHubId = defaultHub?.id || '';
      }

      const hub = hubMap.get(actualHubId);
      if (!hub) continue;

      const hubWeight = hubItems.reduce(
        (sum, item) =>
          sum + Number(item.weight || 0) * Number(item.quantity || 1),
        0
      );

      const { data: rates } = await supabase
        .from('shipping_rates')
        .select('base_rate, rate_per_kg, vat_percentage')
        .eq('hub_id', actualHubId)
        .eq('zone_id', zone.id)
        .limit(1);

      const rate = rates?.[0] || {
        base_rate: 2500,
        rate_per_kg: 500,
        vat_percentage: 7.5,
      };

      const baseRate = Number(rate.base_rate);
      const ratePerKg = Number(rate.rate_per_kg);
      const vatPercentage = Number(rate.vat_percentage);

      const shippingCost = baseRate + hubWeight * ratePerKg;
      const vatAmount = shippingCost * (vatPercentage / 100);
      const totalCost = shippingCost + vatAmount;

      shipments.push({
        hubId: actualHubId,
        hubName: hub.name,
        totalWeight: hubWeight,
        shippingCost,
        vatAmount,
        totalCost,
      });

      totalShippingCost += totalCost;
      totalVat += vatAmount;
    }

    // 🔹 Step 9: Return success
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        total_shipping_cost: Math.round(totalShippingCost * 100) / 100,
        total_vat: Math.round(totalVat * 100) / 100,
        zone_name: zone.name,
        delivery_state: state,
        delivery_city: city,
        total_weight: totalWeight,
        shipments,
        currency: 'NGN',
      }),
    };
  } catch (error) {
    console.error('calc-shipping error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Failed to calculate shipping',
        message: error.message,
      }),
    };
  }
}
