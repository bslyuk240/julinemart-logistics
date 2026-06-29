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
import {
  extractGlobalSourcingFromMeta,
  fetchWooProductSourcingContext,
  mergeGlobalSourcingMetadata,
} from './services/global-sourcing-utils.js';
import {
  autoCreateCjOrdersForSubOrders,
} from './services/global-sourcing-cj.js';

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

function getMeta(meta_data, key) {
  if (!Array.isArray(meta_data)) return null;
  const entry = meta_data.find((meta) => meta?.key === key);
  return entry?.value ?? null;
}

function parseWebhookBody(rawBody) {
  const bodyText = typeof rawBody === 'string' ? rawBody.trim() : '';
  if (!bodyText) {
    return { kind: 'empty', data: {} };
  }

  try {
    return { kind: 'json', data: JSON.parse(bodyText) };
  } catch (_) {
    const params = new URLSearchParams(bodyText);
    const data = Object.fromEntries(params.entries());
    if (Object.keys(data).length > 0) {
      return { kind: 'form', data };
    }
    throw new SyntaxError(`Unsupported webhook payload format: ${bodyText.slice(0, 80)}`);
  }
}

function getFirstMetaValue(metaData, keys) {
  if (!Array.isArray(metaData)) return null;
  for (const key of keys) {
    const value = getMeta(metaData, key);
    if (value !== null && value !== undefined && String(value).trim() !== '') {
      return value;
    }
  }
  return null;
}

function isUuid(value) {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value.trim()
    )
  );
}

const vendorResolutionCache = new Map();

async function resolveLineItemVendorContext(supabaseClient, metaData, productSourcing) {
  const directVendorId = getFirstMetaValue(metaData, ['_jlo_vendor_id', 'vendor_id', '_vendor_id']);
  const sourcingVendorId = productSourcing?.vendorId || null;
  const localVendorId = [directVendorId, sourcingVendorId].find((value) => isUuid(value)) || null;

  if (localVendorId) {
    return {
      vendorId: String(localVendorId).trim(),
      vendorGroupingKey: String(localVendorId).trim(),
      wooVendorId: null,
    };
  }

  const wooVendorIdCandidate =
    [directVendorId, sourcingVendorId].find((value) => value && !isUuid(String(value))) ||
    getFirstMetaValue(metaData, ['_woocommerce_vendor_id', '_wcfm_vendor_id', 'wcfm_vendor_id']) ||
    productSourcing?.woocommerceVendorId ||
    null;

  const normalizedWooVendorId = wooVendorIdCandidate ? String(wooVendorIdCandidate).trim() : '';
  if (!normalizedWooVendorId) {
    return {
      vendorId: null,
      vendorGroupingKey: 'unassigned-vendor',
      wooVendorId: null,
    };
  }

  if (vendorResolutionCache.has(normalizedWooVendorId)) {
    return vendorResolutionCache.get(normalizedWooVendorId);
  }

  const { data: vendor, error } = await supabaseClient
    .from('vendors')
    .select('id, woocommerce_vendor_id')
    .eq('woocommerce_vendor_id', normalizedWooVendorId)
    .maybeSingle();

  if (error) {
    console.warn('Unable to resolve vendor mapping for Woo vendor id:', normalizedWooVendorId, error);
  }

  const resolved = {
    vendorId: vendor?.id || null,
    vendorGroupingKey: vendor?.id || `woo-vendor:${normalizedWooVendorId}`,
    wooVendorId: normalizedWooVendorId,
  };

  if (!vendor?.id) {
    console.warn('No local vendor UUID mapping found for Woo vendor id:', normalizedWooVendorId);
  }

  vendorResolutionCache.set(normalizedWooVendorId, resolved);
  return resolved;
}

async function getDefaultHubId(supabaseClient) {
  try {
    const { data: hubs, error } = await supabaseClient
      .from('hubs')
      .select('id, is_default, metadata')
      .eq('is_active', true)
      .order('name', { ascending: true });
    if (error) throw error;

    const defaultHub =
      (hubs || []).find((hub) => {
        if (hub?.is_default === true) return true;
        const metadata = hub?.metadata && typeof hub.metadata === 'object' ? hub.metadata : {};
        return (
          metadata.default_inbound === true ||
          metadata.is_default_inbound === true ||
          metadata.defaultInbound === true ||
          metadata.isDefaultInbound === true
        );
      }) || hubs?.[0];

    return defaultHub?.id || null;
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

    const parsedPayload = parseWebhookBody(event.body || '');
    if (parsedPayload.kind === 'form' && parsedPayload.data.webhook_id && !parsedPayload.data.id) {
      console.log('Received WooCommerce webhook connectivity/test payload:', parsedPayload.data);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'WooCommerce webhook connectivity payload received',
          webhook_id: parsedPayload.data.webhook_id,
        }),
      };
    }

    wcOrder = parsedPayload.data;

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

    const destinationZoneId = getMeta(
      wcOrder.meta_data,
      '_jlo_destination_zone_id'
    );
    const destinationZoneName = getMeta(
      wcOrder.meta_data,
      '_jlo_destination_zone_name'
    );

    console.log('Customer:', customerInfo.name, customerInfo.email);

    const defaultHubId = await getDefaultHubId(supabase);
    console.log('Default hub:', defaultHubId);

    // Check for duplicate
    const { data: existingOrder, error: existingOrderError } = await supabase
      .from('orders')
      .select('id, woocommerce_order_id')
      .eq('woocommerce_order_id', wcOrder.id.toString())
      .maybeSingle();

    if (existingOrderError) {
      throw existingOrderError;
    }

    if (existingOrder) {
      const { count: existingSubOrdersCount, error: existingSubOrdersError } = await supabase
        .from('sub_orders')
        .select('id', { count: 'exact', head: true })
        .eq('main_order_id', existingOrder.id);

      if (existingSubOrdersError) {
        throw existingSubOrdersError;
      }

      if ((existingSubOrdersCount || 0) > 0) {
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

      console.warn(
        'Existing order has no sub-orders; continuing recovery for order:',
        existingOrder.id
      );
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

    // Group items by hub + vendor
    const orderItems = [];
    const itemsByGroup = {};

    for (const item of wcOrder.line_items || []) {
      const hubId = item.meta_data?.find(m => m.key === '_hub_id' || m.key === 'hub_id')?.value;
      const hubName = item.meta_data?.find(m => m.key === '_hub_name')?.value;
      const weightValue = parseFloat(item.weight || 0);
      const sanitizedWeight = weightValue > 0 ? weightValue : 0.5;
      const lineItemSourcing = extractGlobalSourcingFromMeta(item.meta_data);
      const productSourcing =
        lineItemSourcing ||
        (await fetchWooProductSourcingContext({
          productId: item.product_id?.toString(),
          variationId: item.variation_id ? item.variation_id.toString() : null,
        }));
      const vendorContext = await resolveLineItemVendorContext(
        supabase,
        item.meta_data,
        productSourcing
      );
      const vendorId = vendorContext.vendorId;

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
        vendorId,
        vendorGroupingKey: vendorContext.vendorGroupingKey,
        wooVendorId: vendorContext.wooVendorId,
        variationId,
        variationAttributes,
        globalSourcing: productSourcing
          ? {
              provider: productSourcing.provider || 'cj',
              fulfillmentMode: productSourcing.fulfillmentMode || 'cj_hub',
              cjPid: productSourcing.cjPid || null,
              cjVid: productSourcing.cjVid || null,
              receivingHubId: productSourcing.receivingHubId || hubId || defaultHubId,
              sourcingTag: productSourcing.sourcingTag || 'Ships from Abroad',
            }
          : null,
      };

      orderItems.push(orderItem);

      const resolvedHubId = orderItem.hubId || defaultHubId;
      if (!resolvedHubId) {
        console.warn('Skipping item without hub:', orderItem.productId);
        continue;
      }

      const resolvedVendorGroupKey = orderItem.vendorGroupingKey || orderItem.vendorId || 'unassigned-vendor';
      const groupKey = `${resolvedHubId}::${resolvedVendorGroupKey}`;
      if (!itemsByGroup[groupKey]) {
        itemsByGroup[groupKey] = {
          hubId: resolvedHubId,
          vendorId: orderItem.vendorId || null,
          vendorGroupingKey: resolvedVendorGroupKey,
          items: [],
        };
      }
      itemsByGroup[groupKey].items.push(orderItem);
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

    console.log('\n=== SHIPMENT SPLITTING (HUB + VENDOR) ===');
    console.log(
      'Items grouped by hub+vendor:',
      Object.keys(itemsByGroup).length,
      'groups'
    );
    Object.entries(itemsByGroup).forEach(([groupKey, group]) => {
      console.log(`  📦 ${groupKey}:`, group.items.length, 'items');
    });

    if (Object.keys(itemsByGroup).length === 0) {
      throw new Error(
        `No shippable item groups were created for Woo order ${wcOrder.id}. Check hub assignment/default hub and line item metadata.`
      );
    }

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
    if (!zone) {
      throw new Error(
        `No delivery zone could be resolved for state "${customerInfo.state || 'unknown'}" on Woo order ${wcOrder.id}.`
      );
    }

    // ============================================
    // 🚀 GET LIVE FEZ QUOTES
    // ============================================
    const shippingBreakdown = [];
    let totalCalculatedShipping = 0;
    const customerPaidShipping = parseFloat(wcOrder.shipping_total || 0);

    if (zone) {
      for (const [groupKey, group] of Object.entries(itemsByGroup)) {
        const { hubId, vendorId, items } = group;
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

        // Get courier info (Fez for now)
        const { data: couriers } = await supabase
          .from('couriers')
          .select('id, name, code')
          .eq('code', 'fez')
          .limit(1);
        
        const courier = couriers?.[0] || null;

        shippingBreakdown.push({
          groupKey,
          hubId,
          vendorId,
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
    const numberOfGroups = shippingBreakdown.length;
    
    shippingBreakdown.forEach((breakdown) => {
      // Option A: Equal split (simple)
      breakdown.allocatedShippingFee = numberOfGroups > 0
        ? customerPaidShipping / numberOfGroups
        : 0;
      
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
    if (shippingBreakdown.length === 0) {
      throw new Error(
        `No shipment breakdown could be created for Woo order ${wcOrder.id}. Check hub records, zone matching, and shipping configuration.`
      );
    }
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
        destination_zone_id: destinationZoneId || null,
        destination_zone_name: destinationZoneName || null,
        wc_customer_id: wcOrder.customer_id || null,
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

    let order = existingOrder;

    if (!order) {
      const { data: createdOrder, error: orderError } = await supabase
        .from('orders')
        .insert([orderData])
        .select()
        .single();

      if (orderError) {
        console.error('Order creation error:', orderError);
        throw orderError;
      }

      order = createdOrder;
    } else {
      console.log('\n↺ Reusing incomplete order:', order.id);
    }

    console.log('\n✅ Order created:', order.id);

    // ============================================
    // 📦 CREATE SUB-ORDERS WITH VOUCHER TRACKING
    // ============================================
    if (shippingBreakdown.length > 0) {
      const subOrdersData = shippingBreakdown.map(breakdown => {
        const itemsSubtotal = breakdown.items.reduce((sum, item) => sum + item.total, 0);
        const sourcedItems = breakdown.items.filter(
          item => item.globalSourcing?.fulfillmentMode === 'cj_hub'
        );
        const sourceSeed = sourcedItems[0]?.globalSourcing || null;

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
        
        // JLO placeholder tracking (10–13 chars) for manual/local rider; real Fez tracking overwrites when shipment is created
        const jloPlaceholder = () => {
          const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
          let s = 'JLO-';
          for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
          return s; // e.g. JLO-A1B2C3D4 (12 chars)
        };

        const baseMetadata = {
          selected_lane: 'fez',
          eligible_lanes: ['fez', 'local_rider'],
          destination_zone_id: destinationZoneId || null,
          destination_zone_name: destinationZoneName || null,
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
        };

        const metadata = sourceSeed
          ? mergeGlobalSourcingMetadata(baseMetadata, {
              fulfillment_mode: sourceSeed.fulfillmentMode || 'cj_hub',
              global_sourcing: {
                provider: sourceSeed.provider || 'cj',
                cj_order_id: null,
                receiving_hub_id: sourceSeed.receivingHubId || breakdown.hubId,
                inbound_status: 'awaiting_supplier_fulfillment',
                supplier_order_mode: 'automatic',
                supplier_order_status: 'awaiting_supplier_order',
                inbound_tracking_number: null,
                items: sourcedItems.map(item => ({
                  product_id: item.productId,
                  variation_id: item.variationId,
                  cj_pid: item.globalSourcing?.cjPid || null,
                  cj_vid: item.globalSourcing?.cjVid || null,
                  quantity: item.quantity || 1,
                  name: item.name || null,
                })),
              },
            })
          : baseMetadata;

        return {
          main_order_id: order.id,
          hub_id: breakdown.hubId,
          vendor_id: breakdown.vendorId || null,
          courier_id: breakdown.courierId || null,
          status: 'pending',
          tracking_number: jloPlaceholder(),
          items: breakdown.items,
          subtotal: itemsSubtotal, // Original full price
          real_shipping_cost: breakdown.realShippingCost,
          allocated_shipping_fee: breakdown.allocatedShippingFee,
          metadata
        };
      });

      const { data: subOrders, error: subOrdersError } = await supabase
        .from('sub_orders')
        .insert(subOrdersData)
        .select();

      if (subOrdersError) {
        console.error('Sub-orders error:', subOrdersError);
        throw subOrdersError;
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

        const inboundShipments = subOrders
          .map(subOrder => {
            const sourcing = subOrder.metadata?.global_sourcing;
            if (subOrder.metadata?.fulfillment_mode !== 'cj_hub' || !sourcing) return null;

            const items = Array.isArray(sourcing.items) ? sourcing.items : [];
            const primaryItem = items[0] || {};

            return {
              woo_order_id: wcOrder.id.toString(),
              sub_order_id: subOrder.id,
              vendor_id: subOrder.vendor_id || null,
              hub_id: sourcing.receiving_hub_id || subOrder.hub_id || null,
              provider: sourcing.provider || 'cj',
              cj_order_id: sourcing.cj_order_id || null,
              cj_pid: primaryItem.cj_pid || null,
              cj_vid: primaryItem.cj_vid || null,
              inbound_tracking_number: sourcing.inbound_tracking_number || null,
              inbound_status: sourcing.inbound_status || 'awaiting_supplier_fulfillment',
              supplier_order_mode: sourcing.supplier_order_mode || 'automatic',
              supplier_order_status: sourcing.supplier_order_status || 'awaiting_supplier_order',
              metadata: {
                source: 'woocommerce_webhook_placeholder',
                item_count: items.length,
                items,
              },
            };
          })
          .filter(Boolean);

        if (inboundShipments.length > 0) {
          try {
            await supabase.from('cj_inbound_shipments').insert(inboundShipments);
            console.log('📥 Prepared', inboundShipments.length, 'CJ inbound shipment record(s)');
          } catch (inboundError) {
            console.warn('Unable to create CJ inbound shipment placeholders:', inboundError);
          }
        }

        try {
          const cjResults = await autoCreateCjOrdersForSubOrders({
            client: supabase,
            subOrders,
            wooOrderId: wcOrder.id.toString(),
          });
          if (cjResults.length > 0) {
            console.log('🧾 CJ supplier order results:', cjResults);
          }
        } catch (cjOrderError) {
          console.warn('Unable to auto-create CJ supplier orders:', cjOrderError);
        }

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
