// Which cart lines a campaign voucher may discount. Pure functions (no database
// client) shared by the cart preview (voucherHelpers) and create-order.

/**
 * Check if order items match voucher restrictions
 * @param {Object} voucher - Voucher object
 * @param {Array} orderItems - Array of order items
 * @returns {Object} Matching items and validation result
 */
export function validateVoucherItems(voucher, orderItems) {
  if (
    !voucher.product_ids?.length &&
    !voucher.product_skus?.length &&
    !voucher.vendor_ids?.length &&
    !voucher.category_ids?.length
  ) {
    return {
      isValid: true,
      matchingItems: orderItems,
      message: 'Voucher applies to all items',
    };
  }

  const normalizedProductIds = (voucher.product_ids || [])
    .map((pid) => pid?.toString().trim())
    .filter(Boolean);
  const normalizedProductSkus = (voucher.product_skus || [])
    .map((sku) => sku?.toString().trim().toUpperCase())
    .filter(Boolean);
  const normalizedVendorIds = (voucher.vendor_ids || [])
    .map((vid) => vid?.toString().trim())
    .filter(Boolean);
  const normalizedCategoryIds = (voucher.category_ids || [])
    .map((cid) => cid?.toString().trim())
    .filter(Boolean);
  const requiresProductMatch = normalizedProductIds.length > 0 || normalizedProductSkus.length > 0;

  const matchingItems = orderItems.filter((item) => {
    const itemSku = item.sku ? item.sku.toString().trim().toUpperCase() : '';
    const matchesProductId =
      normalizedProductIds.length > 0 && item.productId
        ? normalizedProductIds.includes(item.productId.toString())
        : false;
    const matchesSku =
      normalizedProductSkus.length > 0 && itemSku && normalizedProductSkus.includes(itemSku);

    if (requiresProductMatch && !matchesProductId && !matchesSku) {
      return false;
    }

    if (normalizedVendorIds.length > 0) {
      if (!item.vendorId) return false;
      if (!normalizedVendorIds.includes(item.vendorId)) return false;
    }

    if (normalizedCategoryIds.length > 0) {
      const itemCategoryIds = (item.categoryIds || []).map((cid) => cid?.toString());
      if (!itemCategoryIds.some((cid) => normalizedCategoryIds.includes(cid))) return false;
    }

    return true;
  });

  if (matchingItems.length === 0) {
    return {
      isValid: false,
      matchingItems: [],
      message: 'No items match voucher restrictions',
    };
  }

  return {
    isValid: true,
    matchingItems,
    message: `Voucher applies to ${matchingItems.length} item(s)`,
  };
}

const hasAny = (values) => (values || []).some((v) => String(v ?? '').trim());

/**
 * Discount for a catalogue order, calculated on the eligible lines only.
 *
 * @param {Object} voucher - campaign_vouchers row
 * @param {Array} lines - server-resolved lines:
 *   { productId, wooProductId, sku, parentSku, vendorId, categoryIds, subtotal }
 * @returns {{ ok: boolean, eligibleSubtotal: number, discount: number, error?: string }}
 */
export function computeCatalogVoucherDiscount(voucher, lines) {
  const rejected = (error) => ({ ok: false, eligibleSubtotal: 0, discount: 0, error });

  const hasCatalogScope = [
    voucher.product_ids,
    voucher.product_skus,
    voucher.vendor_ids,
    voucher.category_ids,
  ].some(hasAny);
  const hasGiftScope = [
    voucher.gift_box_skus,
    voucher.gift_occasion_slugs,
    voucher.gift_recipient_slugs,
  ].some(hasAny);
  // A gift-only voucher has no catalogue restriction, which must not read as
  // "applies to everything".
  if (hasGiftScope && !hasCatalogScope) {
    return rejected('This voucher can only be used on gift orders');
  }

  // A line can be named by its Supabase or WooCommerce product id, and by its
  // variation SKU or parent SKU; any of them satisfies the restriction.
  const eligible = lines.filter((line) => {
    const ids = [line.productId, line.wooProductId].filter(Boolean);
    const skus = [line.sku, line.parentSku].filter(Boolean);
    const candidates = [];
    for (const productId of ids.length ? ids : ['']) {
      for (const sku of skus.length ? skus : ['']) {
        candidates.push({
          productId: String(productId),
          sku,
          vendorId: line.vendorId || '',
          categoryIds: line.categoryIds || [],
        });
      }
    }
    return validateVoucherItems(voucher, candidates).isValid;
  });

  if (eligible.length === 0) {
    return rejected('This voucher does not apply to any item in your cart');
  }

  const eligibleSubtotal = eligible.reduce((sum, line) => sum + Number(line.subtotal || 0), 0);
  // 'free' means 100% off — the admin saves discount_value as 0 for it, so it
  // must not fall into the flat-amount branch.
  const discount = voucher.discount_type === 'free'
    ? eligibleSubtotal
    : voucher.discount_type === 'percentage'
    ? Math.min(Math.round((eligibleSubtotal * Number(voucher.discount_value)) / 100), eligibleSubtotal)
    : Math.min(Number(voucher.discount_value), eligibleSubtotal);

  return { ok: true, eligibleSubtotal, discount };
}
