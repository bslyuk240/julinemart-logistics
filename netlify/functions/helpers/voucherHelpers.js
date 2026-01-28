// Voucher Validation Helper Functions
// Location: /netlify/functions/helpers/voucherHelpers.js

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY ||
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY ||
  process.env.VITE_SUPABASE_KEY ||
  process.env.SUPABASE_ANON_KEY;

const supabase = createClient(SUPABASE_URL || '', SERVICE_ROLE_KEY || '');

const envOrigins = (process.env.VOUCHER_ALLOWED_ORIGIN || '')
  .split(',')
  .map((originEntry) => originEntry.trim())
  .filter(Boolean);

const ORIGIN_WHITELIST = [
  ...envOrigins,
  'https://dev-lab--julinemart-pwa.netlify.app',
  'https://julinemart-pwa.netlify.app',
]
  .filter(Boolean)
  .map((origin) => origin.trim());

const DEFAULT_ORIGIN = ORIGIN_WHITELIST[0] || '*';

function resolveOrigin(originHeader) {
  if (!originHeader) return DEFAULT_ORIGIN;
  if (ORIGIN_WHITELIST.includes('*') || ORIGIN_WHITELIST.includes(originHeader)) {
    return originHeader;
  }
  return DEFAULT_ORIGIN;
}

function buildCorsHeaders(originHeader) {
  const resolvedOrigin = resolveOrigin(originHeader);
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': resolvedOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

/**
 * Validate and process campaign voucher from WooCommerce coupon
 * @param {Object} supabase - Supabase client
 * @param {string} couponCode - Coupon code from WooCommerce
 * @param {Object} orderData - Order information
 * @returns {Promise<Object|null>} Validated voucher or null
 */
export async function validateVoucher(supabase, couponCode, orderData) {
  if (!couponCode) return null;

  try {
    // Look up voucher (case-insensitive)
    const { data: voucher, error } = await supabase
      .from('campaign_vouchers')
      .select('*')
      .ilike('code', couponCode)
      .eq('status', 'active')
      .single();

    if (error || !voucher) {
      console.log(`No active voucher found for code: ${couponCode}`);
      return null;
    }

    console.log(`✅ Found voucher: ${voucher.code} (${voucher.campaign_name})`);

    // Check validity period
    const now = new Date();
    if (voucher.valid_from && new Date(voucher.valid_from) > now) {
      console.log(`❌ Voucher not yet valid: ${voucher.code}`);
      return null;
    }
    if (voucher.valid_until && new Date(voucher.valid_until) < now) {
      console.log(`❌ Voucher expired: ${voucher.code}`);
      await markVoucherExpired(supabase, voucher.id);
      return null;
    }

    // Check usage limits
    if (voucher.current_uses >= voucher.max_uses) {
      console.log(`❌ Voucher fully redeemed: ${voucher.code} (${voucher.current_uses}/${voucher.max_uses})`);
      return null;
    }

    // Check per-customer usage limit
    if (voucher.max_uses_per_customer > 0) {
      const { count } = await supabase
        .from('voucher_redemptions')
        .select('*', { count: 'exact', head: true })
        .eq('voucher_id', voucher.id)
        .eq('customer_email', orderData.customerEmail);

      if (count >= voucher.max_uses_per_customer) {
        console.log(`❌ Customer already used voucher: ${orderData.customerEmail}`);
        return null;
      }
    }

    return voucher;
  } catch (error) {
    console.error('Error validating voucher:', error);
    return null;
  }
}

/**
 * Check if order items match voucher restrictions
 * @param {Object} voucher - Voucher object
 * @param {Array} orderItems - Array of order items
 * @returns {Object} Matching items and validation result
 */
export function validateVoucherItems(voucher, orderItems) {
  // If no restrictions, voucher applies to all items
  if (!voucher.product_ids?.length && !voucher.product_skus?.length && !voucher.vendor_ids?.length) {
    return {
      isValid: true,
      matchingItems: orderItems,
      message: 'Voucher applies to all items'
    };
  }

  const normalizedProductIds = (voucher.product_ids || []).map((pid) => pid?.toString().trim()).filter(Boolean);
  const normalizedProductSkus = (voucher.product_skus || []).map((sku) => sku?.toString().trim().toUpperCase()).filter(Boolean);
  const normalizedVendorIds = (voucher.vendor_ids || []).map((vid) => vid?.toString().trim()).filter(Boolean);
  const requiresProductMatch = normalizedProductIds.length > 0 || normalizedProductSkus.length > 0;

  const matchingItems = orderItems.filter(item => {
    const itemSku = item.sku ? item.sku.toString().trim().toUpperCase() : '';
    const matchesProductId =
      normalizedProductIds.length > 0 && item.productId
        ? normalizedProductIds.includes(item.productId.toString())
        : false;
    const matchesSku = normalizedProductSkus.length > 0 && itemSku && normalizedProductSkus.includes(itemSku);

    if (requiresProductMatch && !matchesProductId && !matchesSku) {
      return false;
    }

    if (normalizedVendorIds.length > 0) {
      if (!item.vendorId) return false;
      if (!normalizedVendorIds.includes(item.vendorId)) return false;
    }

    return true;
  });

  if (matchingItems.length === 0) {
    return {
      isValid: false,
      matchingItems: [],
      message: 'No items match voucher restrictions'
    };
  }

  return {
    isValid: true,
    matchingItems,
    message: `Voucher applies to ${matchingItems.length} item(s)`
  };
}

/**
 * Calculate voucher discount and financial breakdown
 * @param {Object} voucher - Voucher object
 * @param {Array} matchingItems - Items that match voucher restrictions
 * @param {number} wooCommerceDiscount - Actual discount from WooCommerce
 * @returns {Object} Financial breakdown
 */
export function calculateVoucherFinancials(voucher, matchingItems, wooCommerceDiscount) {
  // Calculate original price of matching items
  const originalPrice = matchingItems.reduce((sum, item) => {
    return sum + (item.price * item.quantity);
  }, 0);

  let calculatedDiscount = 0;

  switch (voucher.discount_type) {
    case 'free':
      calculatedDiscount = originalPrice;
      break;
    
    case 'percentage':
      calculatedDiscount = originalPrice * (voucher.discount_value / 100);
      break;
    
    case 'fixed_amount':
      calculatedDiscount = Math.min(voucher.discount_value, originalPrice);
      break;
    
    default:
      calculatedDiscount = wooCommerceDiscount || 0;
  }

  // Use the actual discount from WooCommerce if available (it's authoritative)
  const finalDiscount = wooCommerceDiscount || calculatedDiscount;
  const customerPaid = Math.max(0, originalPrice - finalDiscount);

  return {
    originalPrice,
    discountApplied: finalDiscount,
    customerPaid,
    julinemartAbsorbed: finalDiscount
  };
}

/**
 * Record voucher redemption and update usage counter
 * @param {Object} supabase - Supabase client
 * @param {Object} params - Redemption parameters
 * @returns {Promise<Object>} Redemption record
 */
export async function recordVoucherRedemption(supabase, params) {
  const {
    voucherId,
    orderId,
    subOrderId,
    woocommerceOrderId,
    customerEmail,
    customerName,
    productId,
    vendorId,
    financials,
    vendorPayout,
    orderMetadata
  } = params;

  try {
    // Create redemption record
    const { data: redemption, error: redemptionError } = await supabase
      .from('voucher_redemptions')
      .insert({
        voucher_id: voucherId,
        order_id: orderId,
        sub_order_id: subOrderId,
        woocommerce_order_id: woocommerceOrderId,
        customer_email: customerEmail,
        customer_name: customerName,
        product_id: productId,
        vendor_id: vendorId,
        original_price: financials.originalPrice,
        discount_applied: financials.discountApplied,
        customer_paid: financials.customerPaid,
        vendor_payout: vendorPayout,
        julinemart_absorbed: financials.julinemartAbsorbed,
        order_metadata: orderMetadata || {}
      })
      .select()
      .single();

    if (redemptionError) {
      console.error('Failed to record voucher redemption:', redemptionError);
      throw redemptionError;
    }

    // Increment usage counter and update financial totals
    const { data: voucher } = await supabase
      .from('campaign_vouchers')
      .select('current_uses, max_uses, total_cost_absorbed, total_vendor_payout')
      .eq('id', voucherId)
      .single();

    if (voucher) {
      const newUses = voucher.current_uses + 1;
      const newStatus = newUses >= voucher.max_uses ? 'used' : 'active';

      await supabase
        .from('campaign_vouchers')
        .update({
          current_uses: newUses,
          status: newStatus,
          total_cost_absorbed: (voucher.total_cost_absorbed || 0) + financials.julinemartAbsorbed,
          total_vendor_payout: (voucher.total_vendor_payout || 0) + vendorPayout
        })
        .eq('id', voucherId);

      console.log(`✅ Voucher updated: ${newUses}/${voucher.max_uses} uses`);
      if (newStatus === 'used') {
        console.log(`🔒 Voucher fully redeemed: ${voucherId}`);
      }
    }

    return redemption;
  } catch (error) {
    console.error('Error recording voucher redemption:', error);
    throw error;
  }
}

/**
 * Mark voucher as expired
 * @param {Object} supabase - Supabase client
 * @param {string} voucherId - Voucher UUID
 */
async function markVoucherExpired(supabase, voucherId) {
  try {
    await supabase
      .from('campaign_vouchers')
      .update({ status: 'expired' })
      .eq('id', voucherId);
    console.log(`Voucher marked as expired: ${voucherId}`);
  } catch (error) {
    console.error('Error marking voucher as expired:', error);
  }
}

/**
 * Get voucher summary for logging
 * @param {Object} voucher - Voucher object
 * @param {Object} financials - Financial breakdown
 * @returns {Object} Summary object
 */
export function getVoucherSummary(voucher, financials) {
  return {
    code: voucher.code,
    campaign: voucher.campaign_name,
    type: voucher.discount_type,
    originalPrice: financials.originalPrice,
    discountApplied: financials.discountApplied,
    customerPaid: financials.customerPaid,
    absorbed: financials.julinemartAbsorbed,
    usageCount: `${voucher.current_uses + 1}/${voucher.max_uses}`
  };
}

function normalizeItems(rawItems = []) {
  return rawItems
    .map((item) => {
      const productId =
        item.product_id ?? item.productId ?? item.id ?? item.sku ?? '';
      return {
        productId: productId?.toString(),
        sku: (item.sku || item.product_sku || '').toString(),
        vendorId: item.vendor_id ?? item.vendorId ?? '',
        price: Number(item.price ?? item.unit_price ?? item.unitPrice ?? 0),
        quantity: Number(item.quantity ?? item.qty ?? 1),
      };
    })
    .filter((item) => item.productId);
}

export async function handler(event) {
  const originHeader = event.headers?.origin || event.headers?.Origin || '';
  const headers = buildCorsHeaders(originHeader);

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers,
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ success: false, error: 'Method not allowed' }),
    };
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: 'Supabase not configured' }),
    };
  }

  let payload = {};
  try {
    payload = event.body ? JSON.parse(event.body) : {};
  } catch (error) {
    console.error('Invalid JSON payload for voucher validation', error);
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ success: false, error: 'Invalid JSON payload' }),
    };
  }

  const couponCode = (payload.coupon_code || payload.code || '').toString().trim();
  if (!couponCode) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ success: false, error: 'Missing coupon_code' }),
    };
  }

  const orderData = {
    customerEmail: payload.customer_email || payload.email || '',
    customerName: payload.customer_name || '',
  };

  try {
    const voucher = await validateVoucher(supabase, couponCode, orderData);
    if (!voucher) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ success: false, error: 'Voucher not found or not valid' }),
      };
    }

    const items = normalizeItems(Array.isArray(payload.items) ? payload.items : []);
    const itemValidation = validateVoucherItems(voucher, items);
    if (!itemValidation.isValid) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: itemValidation.message }),
      };
    }

    const overrideDiscount = Number(
      payload.discount_value ??
        payload.shipping_discount ??
        payload.coupon_discount ??
        payload.discount ??
        0
    );

    const financials = calculateVoucherFinancials(
      voucher,
      itemValidation.matchingItems,
      Number.isFinite(overrideDiscount) ? overrideDiscount : 0
    );

    const responseData = {
      id: voucher.id,
      code: voucher.code,
      discount_type: voucher.discount_type,
      discount_value: Number(voucher.discount_value ?? financials.discountApplied) || 0,
      shipping_discount: Number(financials.discountApplied) || 0,
      campaign_name: voucher.campaign_name,
      valid_until: voucher.valid_until ? new Date(voucher.valid_until).toISOString() : null,
      message:
        payload.message ||
        voucher.description ||
        `${voucher.code} is a valid campaign voucher`,
    };

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        data: responseData,
      }),
    };
  } catch (error) {
    console.error('Voucher validation handler error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: 'Failed to validate voucher' }),
    };
  }
}
