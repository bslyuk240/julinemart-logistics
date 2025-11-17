// Updated Webhook Handler with Fez API Integration
// Location: /netlify/functions/woocommerce-webhook.js

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { 
  getShippingQuote, 
  calculateFallbackShipping 
} from './services/fezDeliveryService.js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WC_SECRET = process.env.WOOCOMMERCE_WEBHOOK_SECRET;

const supabase = createClient(SUPABASE_URL || '', SERVICE_KEY || '');
const headers = { 'Content-Type': 'application/json' };

function verifyWebhookSignature(body, signature, secret) {
  if (!secret || !signature) return true;
  const hexHash = crypto.createHmac('sha256', secret).update(body).digest('hex');
  const base64Hash = crypto.createHmac('sha256', secret).update(body).digest('base64');
  return signature === hexHash || signature === base64Hash;
}

async function getDefaultHubId(supabaseClient) {
  try {
    const { data: hub, error: defaultHubError } = await supabaseClient
      .from('hubs')
      .select('id')
      .eq('is_default', true)
      .single();
    if (defaultHubError) throw defaultHubError;
    if (hub?.id) return hub.id;

    const { data: firstHub, error: firstHubError } = await supabaseClient
      .from('hubs')
      .select('id')
      .eq('is_active', true)
      .limit(1)
      .single();
    if (firstHubError) throw firstHubError;
    return firstHub?.id || null;
  } catch (error) {
    console.error('Error fetching default hub:', error);
    return null;
  }
}

export async function handler(event) {
  let wcOrder = null;

  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    const signature = event.headers['x-wc-webhook-signature'];
    if (WC_SECRET && !verifyWebhookSignature(event.body, signature, WC_SECRET)) {
      console.error('Invalid webhook signature');
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid signature' }) };
    }

    wcOrder = JSON.parse(event.body || '{}');

    console.log('=== WEBHOOK RECEIVED ===');
    console.log('Order ID:', wcOrder.id);
    console.log('Order Status:', wcOrder.status);
    console.log('Line Items Count:', wcOrder.line_items?.length);

    // Validation
    const requiredFields = [
      { field: 'id', value: wcOrder.id },
      { field: 'billing.first_name', value: wcOrder.billing?.first_name },
      { field: 'billing.email', value: wcOrder.billing?.email },
      { field: 'shipping.address_1', value: wcOrder.shipping?.address_1 },
      { field: 'shipping.city', value: wcOrder.shipping?.city },
      { field: 'shipping.state', value: wcOrder.shipping?.state },
      { field: 'line_items', value: wcOrder.line_items?.length },
    ];

    const missingFields = requiredFields.filter(({ value }) => !value);
    if (missingFields.length > 0) {
      const missing = missingFields.map(f => f.field).join(', ');
      console.error('Missing required fields:', missing);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'Missing required fields', fields: missing }),
      };
    }

    const { billing, shipping } = wcOrder;
    const customerInfo = {
      name: `${billing.first_name || ''} ${billing.last_name || ''}`.trim(),
      email: billing.email,
      phone: billing.phone,
      address: shipping.address_1 || billing.address_1,
      city: shipping.city || billing.city,
      state: shipping.state || billing.state,
      country: shipping.country || billing.country,
      postcode: shipping.postcode || billing.postcode,
    };

    console.log('Customer:', customerInfo.name, customerInfo.email);

    const defaultHubId = await getDefaultHubId(supabase);
    console.log('Default hub:', defaultHubId);

    // Check for duplicate
    const { data: existingOrder } = await supabase
      .from('orders')
      .select('id, woocommerce_order_id')
      .eq('woocommerce_order_id', wcOrder.id.toString())
      .single();

    if (existingOrder) {
      console.log('Order already processed:', wcOrder.id);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'Order already processed',
          orderId: existingOrder.id,
          duplicate: true,
        }),
      };
    }

    // Group items by hub
    const orderItems = [];
    const itemsByHub = {};

    for (const item of wcOrder.line_items || []) {
      const hubId = item.meta_data?.find(m => m.key === '_hub_id' || m.key === 'hub_id')?.value;
      const hubName = item.meta_data?.find(m => m.key === '_hub_name')?.value;
      const vendorId = item.meta_data?.find(m => m.key === 'vendor_id')?.value;
      const weightValue = parseFloat(item.weight || 0);
      const sanitizedWeight = weightValue > 0 ? weightValue : 0.5;

      const orderItem = {
        productId: item.product_id?.toString(),
        sku: item.sku || `PRODUCT-${item.product_id}`,
        name: item.name,
        quantity: Number(item.quantity || 1),
        price: parseFloat(item.price || 0),
        total: parseFloat(item.total || 0),
        weight: sanitizedWeight,
        hubId: hubId || defaultHubId,
        hubName: hubName,
        vendorId: vendorId || 'default-vendor',
      };

      orderItems.push(orderItem);

      const resolvedHubId = orderItem.hubId || defaultHubId;
      if (!resolvedHubId) {
        console.warn('Skipping item without hub:', orderItem.productId);
        continue;
      }

      if (!itemsByHub[resolvedHubId]) {
        itemsByHub[resolvedHubId] = [];
      }
      itemsByHub[resolvedHubId].push(orderItem);
    }

    console.log('=== HUB SPLITTING ===');
    console.log('Items grouped by hub:', Object.keys(itemsByHub).length, 'hubs');
    Object.entries(itemsByHub).forEach(([hubKey, items]) => {
      console.log(`  📍 Hub ${hubKey}:`, items.length, 'items');
    });

    // Fetch hubs and zones
    const { data: hubs } = await supabase
      .from('hubs')
      .select('id, name, city, state, address, phone');
    const hubMap = new Map((hubs || []).map(h => [h.id, h]));

    const { data: zones } = await supabase
      .from('zones')
      .select('id, code, name, states');

    let zone = zones?.find(
      z =>
        Array.isArray(z.states) &&
        z.states.some(s => s.toLowerCase() === customerInfo.state?.toLowerCase())
    );

    if (!zone && zones && zones.length > 0) {
      zone = zones[0];
    }

    console.log('Delivery State:', customerInfo.state);
    console.log('Assigned Zone:', zone?.name || 'Unknown');

    // ============================================
    // 🚀 NEW: GET LIVE FEZ QUOTES
    // ============================================
    const shippingBreakdown = [];
    let totalCalculatedShipping = 0;
    let totalFezQuotes = 0;
    const customerPaidShipping = parseFloat(wcOrder.shipping_total || 0);

    if (zone) {
      for (const [hubId, items] of Object.entries(itemsByHub)) {
        const hub = hubMap.get(hubId);
        if (!hub) {
          console.warn('No hub record found for', hubId);
          continue;
        }

        const totalWeight = items.reduce(
          (sum, item) => sum + (item.weight || 0) * item.quantity,
          0
        );
        
        const itemsTotal = items.reduce((sum, item) => sum + item.total, 0);

        console.log(`\n🚚 Getting Fez quote for ${hub.name}...`);

        // Try to get live Fez quote
        const fezQuote = await getShippingQuote({
          originCity: hub.city,
          originState: hub.state,
          destinationCity: customerInfo.city,
          destinationState: customerInfo.state,
          weight: totalWeight,
          declaredValue: itemsTotal
        });

        let realShippingCost;
        let usedFezAPI = false;

        if (fezQuote.success) {
          // ✅ Use Fez API quote
          realShippingCost = fezQuote.totalAmount;
          usedFezAPI = true;
          console.log(`✅ Fez quote: ₦${realShippingCost.toLocaleString()}`);
        } else {
          // ⚠️ Fallback to your rates table
          console.log('⚠️ Fez API unavailable, using fallback rates');
          realShippingCost = await calculateFallbackShipping(
            supabase,
            hubId,
            zone.id,
            totalWeight
          );
          console.log(`📊 Fallback rate: ₦${realShippingCost.toLocaleString()}`);
        }

        totalFezQuotes += realShippingCost;

        // Get courier info (Fez for now)
        const { data: couriers } = await supabase
          .from('couriers')
          .select('id, name, code')
          .eq('code', 'fez')
          .limit(1);
        
        const courier = couriers?.[0] || null;

        shippingBreakdown.push({
          hubId,
          hubName: hub.name,
          courierId: courier?.id || '',
          courierName: courier?.name || 'Fez Delivery',
          totalWeight: Math.round(totalWeight * 100) / 100,
          realShippingCost: Math.round(realShippingCost * 100) / 100,
          usedFezAPI,
          items,
        });

        totalCalculatedShipping += realShippingCost;
      }
    }

    // ============================================
    // 💰 ALLOCATE CUSTOMER'S SHIPPING PAYMENT
    // ============================================
    const numberOfHubs = shippingBreakdown.length;
    
    shippingBreakdown.forEach((breakdown, index) => {
      // Option A: Equal split (simple)
      breakdown.allocatedShippingFee = customerPaidShipping / numberOfHubs;
      
      // Option B: Proportional by real cost (more fair)
      // breakdown.allocatedShippingFee = 
      //   (breakdown.realShippingCost / totalFezQuotes) * customerPaidShipping;
      
      // Calculate shipping P&L
      breakdown.shippingProfitLoss = 
        breakdown.allocatedShippingFee - breakdown.realShippingCost;
    });

    console.log('\n=== SHIPPING SUMMARY ===');
    console.log('Customer paid shipping:', `₦${customerPaidShipping.toLocaleString()}`);
    console.log('Total real cost (Fez):', `₦${totalCalculatedShipping.toLocaleString()}`);
    console.log('Shipping P&L:', `₦${(customerPaidShipping - totalCalculatedShipping).toLocaleString()}`);
    
    shippingBreakdown.forEach(b => {
      console.log(`\n  ${b.hubName}:`);
      console.log(`    Real cost: ₦${b.realShippingCost.toLocaleString()}`);
      console.log(`    Allocated: ₦${b.allocatedShippingFee.toLocaleString()}`);
      console.log(`    P&L: ₦${b.shippingProfitLoss.toLocaleString()}`);
      console.log(`    Source: ${b.usedFezAPI ? '✅ Fez API' : '📊 Fallback'}`);
    });

    // Create main order
    const orderData = {
      woocommerce_order_id: wcOrder.id.toString(),
      customer_name: customerInfo.name,
      customer_email: customerInfo.email,
      customer_phone: customerInfo.phone,
      delivery_address: customerInfo.address,
      delivery_city: customerInfo.city,
      delivery_state: customerInfo.state,
      delivery_zone: zone?.name || 'Unknown',
      subtotal: parseFloat(wcOrder.total || 0) - customerPaidShipping,
      total_amount: parseFloat(wcOrder.total || 0),
      shipping_fee_paid: customerPaidShipping,
      payment_status: wcOrder.status === 'processing' ? 'paid' : 'pending',
      overall_status: wcOrder.status === 'processing' ? 'pending' : 'pending',
    };

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert([orderData])
      .select()
      .single();

    if (orderError) {
      console.error('Order creation error:', orderError);
      throw orderError;
    }

    console.log('\n✅ Order created:', order.id);

    // Create sub-orders with Fez data
    if (shippingBreakdown.length > 0) {
      const subOrdersData = shippingBreakdown.map(breakdown => ({
        main_order_id: order.id,
        hub_id: breakdown.hubId,
        courier_id: breakdown.courierId || null,
        status: 'pending',
        tracking_number: `${(breakdown.courierName || 'JLO')
          .substring(0, 3)
          .toUpperCase()}-${Date.now()}-${Math.random()
          .toString(36)
          .substr(2, 6)
          .toUpperCase()}`,
        items: breakdown.items,
        subtotal: breakdown.items.reduce((sum, item) => sum + item.total, 0),
        real_shipping_cost: breakdown.realShippingCost,
        allocated_shipping_fee: breakdown.allocatedShippingFee,
        estimated_shipping_cost: breakdown.realShippingCost, // Can add your table rate here for comparison
        metadata: {
          used_fez_api: breakdown.usedFezAPI,
          shipping_profit_loss: breakdown.shippingProfitLoss,
          quoted_at: new Date().toISOString()
        }
      }));

      const { data: subOrders, error: subOrdersError } = await supabase
        .from('sub_orders')
        .insert(subOrdersData)
        .select();

      if (subOrdersError) {
        console.error('Sub-orders error:', subOrdersError);
      } else {
        console.log('✅ Created', subOrders.length, 'sub-orders');

        // Create tracking events
        const trackingEvents = subOrders.map(subOrder => ({
          sub_order_id: subOrder.id,
          status: 'pending',
          description: 'Order received from WooCommerce',
          location_name: 'Processing Center',
          event_time: new Date().toISOString(),
        }));

        await supabase.from('tracking_events').insert(trackingEvents);
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Order received and processed',
        orderId: order.id,
        subOrdersCount: shippingBreakdown.length,
        shipping: {
          customerPaid: customerPaidShipping,
          realCost: totalCalculatedShipping,
          profitLoss: customerPaidShipping - totalCalculatedShipping
        }
      }),
    };
  } catch (error) {
    console.error('WooCommerce webhook error:', error);

    try {
      await supabase.from('webhook_errors').insert({
        woocommerce_order_id: wcOrder?.id?.toString(),
        error_message: error.message,
        error_stack: error.stack,
        payload: JSON.stringify(wcOrder || {}),
        created_at: new Date().toISOString(),
      });
    } catch (logError) {
      console.error('Failed to log webhook error:', logError);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Failed to process order',
        message: error.message,
        acknowledged: true,
      }),
    };
  }
}