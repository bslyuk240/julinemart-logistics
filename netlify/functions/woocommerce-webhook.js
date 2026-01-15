// Updated Webhook Handler with Fez API Integration + Influencer Tracking + Campaign Vouchers
// Location: /netlify/functions/woocommerce-webhook.js

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { 
  getShippingQuote, 
  calculateFallbackShipping 
} from './services/fezDeliveryService.js';
import {
  validateVoucher,
  validateVoucherItems,
  calculateVoucherFinancials,
  recordVoucherRedemption,
  getVoucherSummary
} from './helpers/voucherHelpers.js';

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

// ============================================
// 🎯 INFLUENCER TRACKING FUNCTION
// ============================================
async function processInfluencerOrder(orderData, supabaseClient) {
  try {
    console.log('\n🎯 Checking for influencer coupons...');
    
    // Check if order has coupon codes
    const couponLines = orderData.coupon_lines || [];
    
    if (couponLines.length === 0) {
      console.log('   ℹ️  No coupons used in this order');
      return null;
    }
    
    // Check each coupon to see if it's an influencer code
    for (const couponLine of couponLines) {
      const couponCode = couponLine.code?.toUpperCase();
      
      if (!couponCode) continue;
      
      console.log(`   🔎 Checking coupon: ${couponCode}`);
      
      // Find influencer by coupon code
      const { data: influencer, error: influencerError } = await supabaseClient
        .from('influencers')
        .select('*')
        .eq('coupon_code', couponCode)
        .eq('status', 'active')
        .single();
      
      if (influencerError || !influencer) {
        console.log(`   ℹ️  ${couponCode} is not an influencer coupon`);
        continue;
      }
      
      console.log(`   ✅ Influencer coupon detected: ${couponCode} (${influencer.name})`);
      
      // Check if already recorded
      const { data: existing } = await supabaseClient
        .from('influencer_sales')
        .select('id')
        .eq('wc_order_id', orderData.id.toString())
        .single();
      
      if (existing) {
        console.log('   ⚠️  Sale already recorded, skipping');
        continue;
      }
      
      // Calculate values
      const orderTotal = parseFloat(orderData.total || 0);
      const shippingTotal = parseFloat(orderData.shipping_total || 0);
      const productTotal = orderTotal - shippingTotal;
      
      // Calculate shipping discount (from coupon)
      const couponDiscount = parseFloat(couponLine.discount || 0);
      const shippingOriginalCost = shippingTotal + couponDiscount;
      const shippingDiscountAmount = couponDiscount;
      const shippingCustomerPaid = shippingTotal;
      
      // Estimate actual shipping cost (use the shipping_total or default)
      const shippingActualCost = shippingTotal > 0 ? shippingTotal : 1500;
      
      // Calculate commission
      const commissionRate = influencer.commission_rate || 5;
      const commissionBase = influencer.commission_based_on === 'order_total' 
        ? orderTotal
        : productTotal;
      const commissionAmount = commissionBase * (commissionRate / 100);
      
      console.log(`   💰 Recording sale:`);
      console.log(`      Product Total: ₦${productTotal.toLocaleString()}`);
      console.log(`      Shipping Original: ₦${shippingOriginalCost.toLocaleString()}`);
      console.log(`      Shipping Discount: ₦${shippingDiscountAmount.toLocaleString()}`);
      console.log(`      Shipping Paid: ₦${shippingCustomerPaid.toLocaleString()}`);
      console.log(`      Commission: ₦${commissionAmount.toLocaleString()} (${commissionRate}% of ₦${commissionBase.toLocaleString()})`);
      
      // Record the sale
      const { data: sale, error: saleError } = await supabaseClient
        .from('influencer_sales')
        .insert({
          influencer_id: influencer.id,
          wc_order_id: orderData.id.toString(),
          order_number: orderData.number || orderData.id.toString(),
          customer_email: orderData.billing?.email || '',
          
          product_total: productTotal,
          
          shipping_original_cost: shippingOriginalCost,
          shipping_discount_amount: shippingDiscountAmount,
          shipping_customer_paid: shippingCustomerPaid,
          shipping_actual_cost: shippingActualCost,
          
          admin_commission: productTotal * 0.05,
          vendor_amount: productTotal * 0.95,
          influencer_commission_rate: commissionRate,
          influencer_commission_amount: commissionAmount,
          
          sale_date: orderData.date_created || new Date().toISOString(),
          order_status: 'completed',
          commission_status: 'pending'
        })
        .select()
        .single();
      
      if (saleError) {
        console.error('   ❌ Failed to record sale:', saleError.message);
        throw saleError;
      }
      
      console.log(`   ✅ Sale recorded successfully: ${sale.id}`);
      
      return {
        success: true,
        influencer: influencer.name,
        sale_id: sale.id,
        commission: commissionAmount
      };
    }
    
    return null;
    
  } catch (error) {
    console.error('❌ Error processing influencer order:', error);
    throw error;
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

    // ============================================
    // 🎟️ VOUCHER & COUPON PROCESSING
    // ============================================
    console.log('\n=== PROCESSING COUPONS ===');

    let voucherData = null;
    let influencerData = null;
    const appliedCoupons = wcOrder.coupon_lines || [];

    for (const coupon of appliedCoupons) {
      const couponCode = coupon.code?.trim();
      if (!couponCode) continue;

      console.log(`Checking coupon: ${couponCode}`);

      // 1. CHECK FOR CAMPAIGN VOUCHER FIRST (higher priority)
      if (!voucherData) {
        const voucher = await validateVoucher(supabase, couponCode, {
          customerEmail: customerInfo.email,
          customerName: customerInfo.name
        });

        if (voucher) {
          // We'll validate items after we parse them below
          voucherData = {
            voucher,
            couponDiscount: parseFloat(coupon.discount || 0),
            couponCode
          };

          console.log('✅ CAMPAIGN VOUCHER DETECTED:', couponCode);
          console.log(`   Campaign: ${voucher.campaign_name}`);
          console.log(`   Type: ${voucher.discount_type}`);
          console.log(`   Usage: ${voucher.current_uses}/${voucher.max_uses}`);
          continue; // Skip influencer check for this code
        }
      }

      // 2. CHECK FOR INFLUENCER CODE (if not already found and no voucher)
      if (!influencerData && !voucherData) {
        const { data: influencer } = await supabase
          .from('influencers')
          .select('*')
          .eq('coupon_code', couponCode.toUpperCase())
          .eq('status', 'active')
          .single();

        if (influencer) {
          influencerData = {
            influencer,
            couponCode,
            discount: parseFloat(coupon.discount || 0)
          };
          console.log(`✅ INFLUENCER CODE: ${couponCode} (${influencer.name})`);
        }
      }
    }

    // Log what we found
    if (voucherData) {
      console.log(`\n📌 Order uses CAMPAIGN VOUCHER: ${voucherData.couponCode}`);
    } else if (influencerData) {
      console.log(`\n📌 Order uses INFLUENCER CODE: ${influencerData.couponCode}`);
    } else if (appliedCoupons.length > 0) {
      console.log(`\n📌 Order has regular WooCommerce coupons (non-JLO)`);
    } else {
      console.log(`\n📌 No coupons applied to this order`);
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

      // Capture variation metadata so downstream UIs can see chosen options
      const variationId = item.variation_id ? item.variation_id.toString() : null;
      const variationAttributes = {};
      (item.meta_data || []).forEach((meta) => {
        const key = meta?.key || meta?.display_key;
        if (!key) return;
        if (key.startsWith('attribute_') || key.startsWith('pa_')) {
          const normalizedKey = key
            .replace(/^attribute_/i, '')
            .replace(/^pa_/i, '');
          variationAttributes[normalizedKey] = meta?.value;
        }
      });

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
        variationId,
        variationAttributes
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

    // NOW validate voucher items (after we have orderItems)
    if (voucherData) {
      const itemValidation = validateVoucherItems(voucherData.voucher, orderItems);
      
      if (itemValidation.isValid) {
        const financials = calculateVoucherFinancials(
          voucherData.voucher,
          itemValidation.matchingItems,
          voucherData.couponDiscount
        );

        voucherData.matchingItems = itemValidation.matchingItems;
        voucherData.financials = financials;

        console.log('\n💰 VOUCHER FINANCIAL BREAKDOWN:');
        console.log(getVoucherSummary(voucherData.voucher, financials));
      } else {
        console.log(`\n❌ Voucher items don't match restrictions: ${itemValidation.message}`);
        console.log('   Proceeding without voucher discount');
        voucherData = null; // Invalid voucher, nullify it
      }
    }

    console.log('\n=== HUB SPLITTING ===');
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
    // 🚀 GET LIVE FEZ QUOTES
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
          courierId: courier?.id || null,
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

    // ============================================
    // 📝 CREATE MAIN ORDER WITH VOUCHER METADATA
    // ============================================
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
      
      // Add voucher discount tracking
      discount_amount: voucherData ? voucherData.financials.discountApplied : 0,
      
      payment_status: wcOrder.status === 'processing' ? 'paid' : 'pending',
      overall_status: wcOrder.status === 'processing' ? 'pending' : 'pending',
      
      // Enhanced metadata with voucher/influencer info
      metadata: {
        ...(voucherData && {
          voucher_code: voucherData.voucher.code,
          voucher_id: voucherData.voucher.id,
          voucher_campaign: voucherData.voucher.campaign_name,
          voucher_discount: voucherData.financials.discountApplied,
          voucher_absorbed: voucherData.financials.julinemartAbsorbed
        }),
        ...(influencerData && {
          influencer_code: influencerData.couponCode,
          influencer_id: influencerData.influencer.id,
          influencer_discount: influencerData.discount
        })
      }
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

    // ============================================
    // 📦 CREATE SUB-ORDERS WITH VOUCHER TRACKING
    // ============================================
    if (shippingBreakdown.length > 0) {
      const subOrdersData = shippingBreakdown.map(breakdown => {
        const itemsSubtotal = breakdown.items.reduce((sum, item) => sum + item.total, 0);
        
        // Calculate vendor commission at FULL PRICE (pre-voucher)
        const vendorCommissionRate = 0.10; // 10% - adjust based on your vendor settings
        const vendorCommission = itemsSubtotal * vendorCommissionRate;
        const vendorPayable = itemsSubtotal - vendorCommission;
        
        // Check if this sub-order contains voucher items
        let voucherInfo = null;
        if (voucherData) {
          const subOrderHasVoucher = breakdown.items.some(item =>
            voucherData.matchingItems.some(vItem => vItem.productId === item.productId)
          );
          
          if (subOrderHasVoucher) {
            // Calculate proportion of voucher discount for this sub-order
            const subOrderVoucherItems = breakdown.items.filter(item =>
              voucherData.matchingItems.some(vItem => vItem.productId === item.productId)
            );
            
            const subOrderVoucherValue = subOrderVoucherItems.reduce((sum, item) => 
              sum + (item.price * item.quantity), 0
            );
            
            const proportionalDiscount = (subOrderVoucherValue / voucherData.financials.originalPrice) * 
              voucherData.financials.discountApplied;
            
            voucherInfo = {
              voucher_id: voucherData.voucher.id,
              voucher_code: voucherData.voucher.code,
              original_subtotal: itemsSubtotal,
              discount_applied: proportionalDiscount,
              customer_paid: itemsSubtotal - proportionalDiscount,
              vendor_receives: vendorPayable, // FULL amount (pre-discount)
              julinemart_absorbed: proportionalDiscount
            };
          }
        }
        
        return {
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
          subtotal: itemsSubtotal, // Original full price
          real_shipping_cost: breakdown.realShippingCost,
          allocated_shipping_fee: breakdown.allocatedShippingFee,
          estimated_shipping_cost: breakdown.realShippingCost,
          
          // Add voucher metadata to sub-order
          metadata: {
            ...(voucherInfo && {
              voucher: voucherInfo
            }),
            ...(influencerData && {
              influencer_code: influencerData.couponCode,
              influencer_id: influencerData.influencer.id
            }),
            used_fez_api: breakdown.usedFezAPI,
            shipping_profit_loss: breakdown.shippingProfitLoss,
            quoted_at: new Date().toISOString()
          }
        };
      });

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
          description: 'Order received from JulineMart',
          location_name: 'Processing Center',
          event_time: new Date().toISOString(),
        }));

        await supabase.from('tracking_events').insert(trackingEvents);

        // ============================================
        // 🎟️ RECORD VOUCHER REDEMPTIONS
        // ============================================
        if (voucherData) {
          console.log('\n=== RECORDING VOUCHER REDEMPTIONS ===');
          
          for (const subOrder of subOrders) {
            const voucherInfo = subOrder.metadata?.voucher;
            if (!voucherInfo) continue;
            
            // Get vendor for this sub-order
            const { data: vendorData } = await supabase
              .from('vendors')
              .select('id')
              .eq('hub_id', subOrder.hub_id)
              .single();
            
            try {
              await recordVoucherRedemption(supabase, {
                voucherId: voucherInfo.voucher_id,
                orderId: order.id,
                subOrderId: subOrder.id,
                woocommerceOrderId: wcOrder.id.toString(),
                customerEmail: customerInfo.email,
                customerName: customerInfo.name,
                productId: subOrder.items[0]?.productId, // Primary product
                vendorId: vendorData?.id,
                financials: {
                  originalPrice: voucherInfo.original_subtotal,
                  discountApplied: voucherInfo.discount_applied,
                  customerPaid: voucherInfo.customer_paid,
                  julinemartAbsorbed: voucherInfo.julinemart_absorbed
                },
                vendorPayout: voucherInfo.vendor_receives,
                orderMetadata: {
                  hub_id: subOrder.hub_id,
                  tracking_number: subOrder.tracking_number
                }
              });
              
              console.log(`✅ Voucher redemption recorded for sub-order: ${subOrder.id}`);
            } catch (redemptionError) {
              console.error(`❌ Failed to record redemption for sub-order ${subOrder.id}:`, redemptionError);
            }
          }
        }
      }
    }

    // ============================================
    // 🎯 PROCESS INFLUENCER TRACKING
    // (Only if NOT a voucher order)
    // ============================================
    let influencerResult = null;
    
    if (influencerData && !voucherData) {
      try {
        influencerResult = await processInfluencerOrder(wcOrder, supabase);
        
        if (influencerResult) {
          console.log(`\n✅ INFLUENCER SALE RECORDED!`);
          console.log(`   Influencer: ${influencerResult.influencer}`);
          console.log(`   Commission: ₦${influencerResult.commission.toLocaleString()}`);
        }
      } catch (influencerError) {
        // Don't fail the whole webhook if influencer tracking fails
        console.error('\n⚠️  Influencer tracking error:', influencerError);
        console.error('   Continuing with order processing...');
      }
    } else if (voucherData) {
      console.log('\n📌 Skipping influencer tracking (voucher order takes precedence)');
    }

    // ============================================
    // 🎉 SUCCESS RESPONSE
    // ============================================
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
        },
        ...(voucherData && {
          voucher: {
            code: voucherData.voucher.code,
            campaign: voucherData.voucher.campaign_name,
            discount: voucherData.financials.discountApplied,
            absorbed: voucherData.financials.julinemartAbsorbed
          }
        }),
        ...(influencerResult && {
          influencer: influencerResult.influencer,
          commission: influencerResult.commission
        })
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