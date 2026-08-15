/**
 * Gift G4.5 commercial pricing + line resolution.
 *
 * Customer pays one gift price (markup/margin/discount on platform).
 * Vendor catalog lines settle at catalog retail regardless of customer gift price.
 */

export function catalogUnitPrice(product, variation) {
  const source = variation || product;
  return Number(source?.sale_price || source?.regular_price || product?.sale_price || product?.regular_price || 0);
}

export async function loadGiftCommercialSettings(adminClient, gfcId) {
  if (gfcId) {
    const { data } = await adminClient
      .from('gift_commercial_settings')
      .select('packaging_markup, profit_margin_percent, profit_margin_fixed')
      .eq('gift_fulfilment_centre_id', gfcId)
      .eq('active', true)
      .maybeSingle();
    if (data) return data;
  }

  const { data: fallback } = await adminClient
    .from('gift_commercial_settings')
    .select('packaging_markup, profit_margin_percent, profit_margin_fixed')
    .eq('active', true)
    .limit(1)
    .maybeSingle();

  return (
    fallback || {
      packaging_markup: 500,
      profit_margin_percent: 15,
      profit_margin_fixed: 0,
    }
  );
}

/**
 * Customer-facing gift total from internal cost base + packaging + margin stack.
 * Does NOT affect vendor_settlement_subtotal on individual lines.
 */
export function computeCustomerGiftTotal({
  componentCostTotal,
  packagingFee = 0,
  settings,
  discountAmount = 0,
  explicitListPrice,
}) {
  const packagingMarkup = Number(settings?.packaging_markup || 0);
  const marginPct = Number(settings?.profit_margin_percent || 0);
  const marginFixed = Number(settings?.profit_margin_fixed || 0);
  const packaging = Number(packagingFee || 0);

  const costBase = Number(componentCostTotal || 0);
  const stackBeforeDiscount =
    explicitListPrice != null && Number.isFinite(Number(explicitListPrice))
      ? Number(explicitListPrice)
      : Math.round(
          (costBase + packaging + packagingMarkup) * (1 + marginPct / 100) + marginFixed
        );

  const platformDiscount = Math.max(0, Math.min(Number(discountAmount || 0), stackBeforeDiscount));
  const customerSubtotal = stackBeforeDiscount;
  const customerTotal = Math.max(stackBeforeDiscount - platformDiscount, 0);

  return {
    customerSubtotal,
    customerTotal,
    platformDiscount,
    pricingBreakdown: {
      component_cost_total: costBase,
      packaging_fee: packaging,
      packaging_markup: packagingMarkup,
      profit_margin_percent: marginPct,
      profit_margin_fixed: marginFixed,
      subtotal_before_discount: stackBeforeDiscount,
      platform_discount: platformDiscount,
      explicit_list_price: explicitListPrice ?? null,
    },
  };
}

export function resolveUnitCost({ componentCost, giftProgramCost, productCostPrice }) {
  if (componentCost != null && componentCost !== '') return Number(componentCost);
  if (giftProgramCost != null && giftProgramCost !== '') return Number(giftProgramCost);
  return Number(productCostPrice || 0);
}

export function poolKey(productId, variationId) {
  return `${productId}:${variationId || ''}`;
}

/**
 * Group vendor catalog lines for sub_orders (mirrors create-order vendor groups).
 */
export function groupVendorSubOrders(resolvedVendorLines) {
  const vendorGroups = new Map();
  for (const item of resolvedVendorLines) {
    const key = item.vendor_id || 'unassigned';
    if (!vendorGroups.has(key)) {
      vendorGroups.set(key, {
        vendor_id: item.vendor_id,
        hub_id: item.hub_id,
        items: [],
        subtotal: 0,
      });
    }
    const group = vendorGroups.get(key);
    group.subtotal += item.subtotal;
    group.items.push({
      productId: item.product_id,
      variationId: item.variation_id,
      name: item.product_name,
      sku: item.product_sku,
      price: item.unit_price,
      quantity: item.quantity,
      total: item.subtotal,
      vendorId: item.vendor_id,
      hubId: item.hub_id,
    });
  }
  return vendorGroups;
}
