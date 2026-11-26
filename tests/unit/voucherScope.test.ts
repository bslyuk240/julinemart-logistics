import { describe, it, expect } from 'vitest';
// @ts-ignore - plain JS module
import { computeCatalogVoucherDiscount } from '../../netlify/functions/services/voucher-scope.js';

const blender = {
  productId: 'uuid-blender', wooProductId: 101, sku: 'HOM-VIK-046-RED', parentSku: 'HOM-VIK-046',
  vendorId: 'vendor-a', categoryIds: ['cat-kitchen'], subtotal: 40000,
};
const phone = {
  productId: 'uuid-phone', wooProductId: null, sku: 'PHN-1', parentSku: 'PHN-1',
  vendorId: 'vendor-b', categoryIds: ['cat-phones'], subtotal: 100000,
};
const cart = [blender, phone];
const run = (voucher: object, lines = cart) => computeCatalogVoucherDiscount(voucher, lines);

describe('computeCatalogVoucherDiscount', () => {
  it('discounts the whole cart when unrestricted', () => {
    expect(run({ discount_type: 'percentage', discount_value: 20 }).discount).toBe(28000);
    expect(run({ discount_type: 'free', discount_value: 0, product_ids: [], vendor_ids: [] }).discount).toBe(140000);
  });

  it('makes only the named product free on a mixed cart', () => {
    expect(run({ discount_type: 'free', product_skus: ['HOM-VIK-046'] }).discount).toBe(40000);
  });

  it('matches by variation SKU, Supabase id or WooCommerce id', () => {
    for (const scope of [
      { product_skus: ['hom-vik-046-red'] },
      { product_ids: ['uuid-blender'] },
      { product_ids: ['101'] },
    ]) {
      expect(run({ discount_type: 'free', ...scope }).discount).toBe(40000);
    }
  });

  it('limits a vendor voucher to those vendors', () => {
    expect(run({ discount_type: 'percentage', discount_value: 20, vendor_ids: ['vendor-a', 'vendor-c'] }).discount).toBe(8000);
  });

  it('limits a category voucher to that category', () => {
    expect(run({ discount_type: 'percentage', discount_value: 10, category_ids: ['cat-phones'] }).discount).toBe(10000);
  });

  it('requires every kind of restriction on the same line', () => {
    const result = run({ discount_type: 'free', product_skus: ['HOM-VIK-046'], vendor_ids: ['vendor-b'] });
    expect(result.ok).toBe(false);
  });

  it('caps a fixed amount at the eligible subtotal', () => {
    expect(run({ discount_type: 'fixed_amount', discount_value: 60000, vendor_ids: ['vendor-a'] }).discount).toBe(40000);
  });

  it('rejects a cart with no eligible item', () => {
    const result = run({ discount_type: 'free', product_skus: ['HOM-VIK-046'] }, [phone]);
    expect(result).toMatchObject({ ok: false, discount: 0 });
  });

  it('rejects a gift-only voucher on a catalogue cart', () => {
    for (const scope of [
      { gift_box_skus: ['GBX-1'] },
      { gift_occasion_slugs: ['birthday'] },
      { gift_recipient_slugs: ['for-her'] },
    ]) {
      expect(run({ discount_type: 'free', ...scope }).ok).toBe(false);
    }
  });
});
