/**
 * Influencer shipping discount + recording sales for PWA / Supabase-native orders.
 * (Legacy WooCommerce path used coupon_lines on webhook payloads.)
 */

/**
 * @param {Record<string, unknown>} influencer Row from public.influencers
 * @param {number} shippingCost Base shipping in ₦ (before influencer discount)
 * @returns {number} Discount amount in ₦ (rounded)
 */
export function computeInfluencerShippingDiscount(influencer, shippingCost) {
  const cost = Math.max(Number(shippingCost) || 0, 0);
  if (!influencer || cost <= 0) return 0;

  const discountType = influencer.shipping_discount_type || 'percentage';
  const discountValue = parseFloat(influencer.shipping_discount_value || '0');

  let shippingDiscount = 0;
  if (discountType === 'percentage') {
    shippingDiscount = (cost * discountValue) / 100;
  } else if (discountType === 'fixed') {
    shippingDiscount = discountValue;
  } else if (discountType === 'free') {
    shippingDiscount = cost;
  }

  shippingDiscount = Math.min(shippingDiscount, cost);
  return Math.round(shippingDiscount);
}

/**
 * After payment succeeds, insert influencer_sales when order.metadata.influencer is set.
 * Idempotent per order id (wc_order_id stores Supabase order UUID for native orders).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} adminClient
 * @param {Record<string, unknown>} order Full orders row
 * @returns {Promise<Record<string, unknown>|null>}
 */
export async function recordInfluencerSaleForPaidOrder(adminClient, order) {
  if (!order?.id) return null;

  const meta =
    order.metadata && typeof order.metadata === 'object' && !Array.isArray(order.metadata)
      ? order.metadata
      : {};
  const inf = meta.influencer;
  if (!inf?.influencer_id) return null;

  const orderRef = String(order.id);

  const { data: existing } = await adminClient
    .from('influencer_sales')
    .select('id')
    .eq('wc_order_id', orderRef)
    .maybeSingle();

  if (existing) {
    return null;
  }

  const { data: influencer, error: infErr } = await adminClient
    .from('influencers')
    .select('*')
    .eq('id', inf.influencer_id)
    .maybeSingle();

  if (infErr || !influencer) {
    console.warn('recordInfluencerSaleForPaidOrder: influencer not found', inf?.influencer_id);
    return null;
  }

  if (influencer.status !== 'active') {
    console.warn('recordInfluencerSaleForPaidOrder: influencer not active', inf?.influencer_id);
    return null;
  }

  const subtotal = parseFloat(order.subtotal || 0);
  const discountAmount = parseFloat(order.discount_amount || 0);
  const productTotal = Math.max(subtotal - discountAmount, 0);
  const shippingCustomerPaid = parseFloat(order.shipping_fee_paid || 0);
  const shippingDiscountAmount = parseFloat(inf.shipping_discount_amount || 0);
  const shippingOriginalCost =
    inf.shipping_base_amount != null
      ? parseFloat(inf.shipping_base_amount)
      : shippingCustomerPaid + shippingDiscountAmount;

  const orderTotal = parseFloat(order.total_amount || 0);
  const commissionRate = parseFloat(influencer.commission_rate || 5);
  const commissionBase =
    influencer.commission_based_on === 'order_total' ? orderTotal : productTotal;
  const commissionAmount = commissionBase * (commissionRate / 100);

  const shippingActualCost = shippingCustomerPaid > 0 ? shippingCustomerPaid : 1500;

  const { data: sale, error: saleError } = await adminClient
    .from('influencer_sales')
    .insert({
      influencer_id: influencer.id,
      wc_order_id: orderRef,
      order_number: String(order.order_number ?? order.id),
      customer_email: order.customer_email || '',

      product_total: productTotal,

      shipping_original_cost: shippingOriginalCost,
      shipping_discount_amount: shippingDiscountAmount,
      shipping_customer_paid: shippingCustomerPaid,
      shipping_actual_cost: shippingActualCost,

      admin_commission: productTotal * 0.05,
      vendor_amount: productTotal * 0.95,
      influencer_commission_rate: commissionRate,
      influencer_commission_amount: commissionAmount,

      sale_date: order.created_at || new Date().toISOString(),
      order_status: 'completed',
      commission_status: 'pending',
    })
    .select()
    .single();

  if (saleError) {
    console.error('recordInfluencerSaleForPaidOrder: insert failed', saleError.message);
    throw saleError;
  }

  await adminClient.rpc('update_influencer_stats', { p_influencer_id: influencer.id }).catch((e) => {
    console.warn('update_influencer_stats:', e?.message || e);
  });

  return sale;
}
