// Voucher Validation Helper Functions
// Location: /netlify/functions/helpers/voucherHelpers.js

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
  if (!voucher.product_ids?.length && !voucher.vendor_ids?.length) {
    return {
      isValid: true,
      matchingItems: orderItems,
      message: 'Voucher applies to all items'
    };
  }

  const matchingItems = orderItems.filter(item => {
    // Check product ID restriction
    if (voucher.product_ids?.length > 0) {
      const matches = voucher.product_ids.includes(item.productId?.toString());
      if (!matches) return false;
    }

    // Check vendor ID restriction
    if (voucher.vendor_ids?.length > 0) {
      const matches = voucher.vendor_ids.includes(item.vendorId);
      if (!matches) return false;
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