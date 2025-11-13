// Netlify Function: /netlify/functions/woocommerce-webhook.js
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WC_SECRET = process.env.WOOCOMMERCE_WEBHOOK_SECRET; // Set this in Netlify
const supabase = createClient(SUPABASE_URL || '', SERVICE_KEY || '');

const headers = {
  'Content-Type': 'application/json',
};

// Verify WooCommerce webhook signature
function verifyWebhookSignature(body, signature, secret) {
  if (!secret || !signature) return true; // Skip verification if not configured
  
  const hash = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('base64');
  
  return hash === signature;
}

export async function handler(event) {
  try {
    // Only accept POST requests
    if (event.httpMethod !== 'POST') {
      return {
        statusCode: 405,
        headers,
        body: JSON.stringify({ error: 'Method not allowed' })
      };
    }

    // Verify webhook signature (if secret is configured)
    const signature = event.headers['x-wc-webhook-signature'];
    if (WC_SECRET && !verifyWebhookSignature(event.body, signature, WC_SECRET)) {
      console.error('Invalid webhook signature');
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Invalid signature' })
      };
    }

    // Parse WooCommerce order data
    const wcOrder = JSON.parse(event.body);
    
    console.log('Received WooCommerce order:', wcOrder.id);

    // Extract customer information
    const customerInfo = {
      name: `${wcOrder.billing.first_name} ${wcOrder.billing.last_name}`.trim(),
      email: wcOrder.billing.email,
      phone: wcOrder.billing.phone,
      address: wcOrder.billing.address_1,
      city: wcOrder.billing.city,
      state: wcOrder.billing.state,
      country: wcOrder.billing.country,
      postcode: wcOrder.billing.postcode
    };

    // Extract order items and group by hub
    const orderItems = [];
    const itemsByHub = {};

    for (const item of wcOrder.line_items) {
      // Get product meta for hub assignment
      const hubId = item.meta_data?.find(m => m.key === '_jlo_hub_id')?.value;
      const vendorId = item.meta_data?.find(m => m.key === '_jlo_vendor_id')?.value;
      
      const orderItem = {
        productId: item.product_id.toString(),
        sku: item.sku,
        name: item.name,
        quantity: item.quantity,
        price: parseFloat(item.price),
        total: parseFloat(item.total),
        weight: parseFloat(item.weight || 0.5), // Default 0.5kg if not set
        hubId: hubId || null,
        vendorId: vendorId || null
      };

      orderItems.push(orderItem);

      // Group by hub
      const hub = hubId || 'default';
      if (!itemsByHub[hub]) {
        itemsByHub[hub] = [];
      }
      itemsByHub[hub].push(orderItem);
    }

    // Calculate shipping breakdown for each hub
    const shippingBreakdown = [];
    let totalCalculatedShipping = 0;

    // Get hubs and shipping rates from database
    const { data: hubs } = await supabase
      .from('hubs')
      .select('id, name, city, state');

    const hubMap = new Map((hubs || []).map(h => [h.id, h]));

    // Find zone for delivery state
    const { data: zones } = await supabase
      .from('zones')
      .select('id, code, name, states');

    let zone = zones?.find(z => 
      Array.isArray(z.states) && 
      z.states.some(s => s.toLowerCase() === customerInfo.state.toLowerCase())
    );

    if (!zone && zones && zones.length > 0) {
      zone = zones[0]; // Fallback to first zone
    }

    if (zone) {
      for (const [hubId, items] of Object.entries(itemsByHub)) {
        let actualHubId = hubId;
        
        // Assign default hub if not specified
        if (hubId === 'default') {
          const defaultHub = hubs?.find(h => 
            h.state?.toLowerCase() === customerInfo.state.toLowerCase()
          ) || hubs?.[0];
          actualHubId = defaultHub?.id || '';
        }

        const hub = hubMap.get(actualHubId);
        if (!hub) continue;

        // Calculate total weight for this hub
        const totalWeight = items.reduce((sum, item) => 
          sum + (item.weight * item.quantity), 0
        );

        // Get shipping rate
        const { data: rates } = await supabase
          .from('shipping_rates')
          .select('*, couriers(id, name, code)')
          .eq('hub_id', actualHubId)
          .eq('zone_id', zone.id)
          .eq('is_active', true)
          .limit(1);

        const rate = rates?.[0];
        if (!rate) continue;

        const baseRate = Number(rate.base_rate || 0);
        const ratePerKg = Number(rate.rate_per_kg || 0);
        const vatPercentage = Number(rate.vat_percentage || 7.5);

        const shippingCost = baseRate + (totalWeight * ratePerKg);
        const vatAmount = shippingCost * (vatPercentage / 100);
        const totalShippingFee = shippingCost + vatAmount;

        const courier = rate.couriers;

        shippingBreakdown.push({
          hubId: actualHubId,
          hubName: hub.name,
          courierId: courier?.id || '',
          courierName: courier?.name || 'Standard Courier',
          totalWeight: Math.round(totalWeight * 100) / 100,
          totalShippingFee: Math.round(totalShippingFee * 100) / 100,
          items: items
        });

        totalCalculatedShipping += totalShippingFee;
      }
    }

    // Create order in JLO database
    const orderData = {
      woocommerce_order_id: wcOrder.id.toString(),
      customer_name: customerInfo.name,
      customer_email: customerInfo.email,
      customer_phone: customerInfo.phone,
      delivery_address: customerInfo.address,
      delivery_city: customerInfo.city,
      delivery_state: customerInfo.state,
      delivery_zone: zone?.name || 'Unknown',
      subtotal: parseFloat(wcOrder.total) - parseFloat(wcOrder.shipping_total),
      total_amount: parseFloat(wcOrder.total),
      shipping_fee_paid: parseFloat(wcOrder.shipping_total),
      payment_status: wcOrder.status === 'processing' ? 'paid' : 'pending',
      overall_status: wcOrder.status === 'processing' ? 'pending' : 'pending'
    };

    // Insert main order
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert([orderData])
      .select()
      .single();

    if (orderError) {
      console.error('Order creation error:', orderError);
      throw orderError;
    }

    console.log('Order created in JLO:', order.id);

    // Create sub-orders
    if (shippingBreakdown.length > 0) {
      const subOrdersData = shippingBreakdown.map(breakdown => ({
        main_order_id: order.id,
        hub_id: breakdown.hubId,
        courier_id: breakdown.courierId || null,
        status: 'pending',
        tracking_number: `${(breakdown.courierName || 'JLO').substring(0, 3).toUpperCase()}-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`,
        items: breakdown.items,
        subtotal: breakdown.items.reduce((sum, item) => sum + item.total, 0),
        real_shipping_cost: breakdown.totalShippingFee,
        allocated_shipping_fee: breakdown.totalShippingFee
      }));

      const { data: subOrders, error: subOrdersError } = await supabase
        .from('sub_orders')
        .insert(subOrdersData)
        .select();

      if (subOrdersError) {
        console.error('Sub-orders error:', subOrdersError);
      } else {
        console.log('Created', subOrders.length, 'sub-orders');

        // Create initial tracking events
        const trackingEvents = subOrders.map(subOrder => ({
          sub_order_id: subOrder.id,
          status: 'pending',
          description: 'Order received from WooCommerce',
          location_name: 'Processing Center',
          event_time: new Date().toISOString()
        }));

        await supabase
          .from('tracking_events')
          .insert(trackingEvents);
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Order received and processed',
        orderId: order.id,
        subOrdersCount: shippingBreakdown.length
      })
    };

  } catch (error) {
    console.error('WooCommerce webhook error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Failed to process order',
        message: error.message
      })
    };
  }
}
