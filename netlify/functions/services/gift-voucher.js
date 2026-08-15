/**
 * Campaign voucher validation for gift orders (platform-absorbed discount).
 */
import {
  validateVoucher,
  validateVoucherItems,
  recordVoucherRedemption,
} from '../helpers/voucherHelpers.js';

export function computeGiftVoucherDiscount(voucher, customerSubtotal) {
  const subtotal = Math.max(0, Number(customerSubtotal || 0));
  if (!subtotal) return 0;

  switch (voucher.discount_type) {
    case 'percentage':
      return Math.min(
        subtotal,
        Math.round((subtotal * Number(voucher.discount_value || 0)) / 100)
      );
    case 'fixed_amount':
      return Math.min(Number(voucher.discount_value || 0), subtotal);
    case 'free':
      return subtotal;
    default:
      return 0;
  }
}

async function loadCategoryIdsByProduct(adminClient, productUuids) {
  if (!productUuids.length) return new Map();
  const { data: rows } = await adminClient
    .from('product_category_map')
    .select('product_id, category_id')
    .in('product_id', productUuids);

  const map = new Map();
  for (const row of rows || []) {
    if (!map.has(row.product_id)) map.set(row.product_id, []);
    map.get(row.product_id).push(row.category_id);
  }
  return map;
}

/**
 * Map resolved gift lines to voucherHelpers item shape (product/vendor/category keys).
 */
export async function giftLinesToVoucherItems(adminClient, lines, customerSubtotal) {
  const productUuids = [...new Set(lines.map((l) => l.product_id).filter(Boolean))];
  let productMap = new Map();

  if (productUuids.length) {
    const { data: products, error } = await adminClient
      .from('products')
      .select('id, woo_product_id, sku, vendor_id')
      .in('id', productUuids);
    if (error) throw error;
    productMap = new Map((products || []).map((p) => [p.id, p]));
  }

  const categoryMap = await loadCategoryIdsByProduct(adminClient, productUuids);
  const lineShare =
    lines.length > 0 ? Number(customerSubtotal || 0) / lines.length : Number(customerSubtotal || 0);

  return lines.map((line) => {
    const product = line.product_id ? productMap.get(line.product_id) : null;
    const productId = product?.woo_product_id
      ? String(product.woo_product_id)
      : line.product_id
        ? String(line.product_id)
        : '';

    return {
      productId,
      sku: (line.sku || product?.sku || '').toString(),
      vendorId: line.vendor_id || product?.vendor_id || '',
      price: lineShare,
      quantity: Number(line.quantity || 1),
      categoryIds: line.product_id ? categoryMap.get(line.product_id) || [] : [],
    };
  });
}

export async function validateGiftCampaignVoucher(adminClient, params) {
  const code = String(params.code || params.voucher_code || '').trim();
  const customerEmail = String(params.customerEmail || params.customer_email || '').trim();
  const customerSubtotal = Math.max(0, Number(params.customerSubtotal || 0));
  const lines = params.lines || [];

  if (!code) throw new Error('Voucher code required');
  if (!customerEmail) throw new Error('Customer email required for voucher validation');
  if (!customerSubtotal) throw new Error('Order subtotal required');

  const voucher = await validateVoucher(adminClient, code.toUpperCase(), { customerEmail });
  if (!voucher) throw new Error('Invalid or expired voucher code');

  const voucherItems = await giftLinesToVoucherItems(adminClient, lines, customerSubtotal);
  const itemValidation = validateVoucherItems(voucher, voucherItems);
  if (!itemValidation.isValid) {
    throw new Error(itemValidation.message || 'Voucher does not apply to this gift order');
  }

  const discountAmount = computeGiftVoucherDiscount(voucher, customerSubtotal);

  return {
    voucher,
    discountAmount,
    code: voucher.code,
    campaign_name: voucher.campaign_name,
  };
}

export async function recordGiftVoucherRedemption(adminClient, {
  voucher,
  orderId,
  customerEmail,
  customerName,
  customerSubtotal,
  discountAmount,
  vendorSettlementSubtotal,
  orderKind,
}) {
  const financials = {
    originalPrice: customerSubtotal,
    discountApplied: discountAmount,
    customerPaid: Math.max(customerSubtotal - discountAmount, 0),
    julinemartAbsorbed: discountAmount,
  };

  await recordVoucherRedemption(adminClient, {
    voucherId: voucher.id,
    orderId,
    customerEmail,
    customerName,
    financials,
    vendorPayout: vendorSettlementSubtotal,
    orderMetadata: {
      order_kind: orderKind,
      gift_order: true,
      platform_discount_absorbed: true,
    },
  });
}
