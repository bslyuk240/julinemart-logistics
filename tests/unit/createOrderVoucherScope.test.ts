import { describe, it, expect, vi } from 'vitest';

// Runs the real create-order handler in quote-only mode (no writes) against an
// in-memory database, to check the voucher wiring end to end.
const db: Record<string, any[]> = {
  products: [
    { id: '11111111-1111-1111-1111-111111111111', name: 'Blender', sku: 'HOM-VIK-046', regular_price: 40000, vendor_id: 'vendor-a', type: 'simple' },
    { id: '22222222-2222-2222-2222-222222222222', name: 'Phone', sku: 'PHN-1', regular_price: 100000, vendor_id: 'vendor-b', type: 'simple' },
  ],
  product_category_map: [{ product_id: '22222222-2222-2222-2222-222222222222', category_id: 'cat-phones' }],
  campaign_vouchers: [],
};

vi.mock('../../netlify/functions/services/global-sourcing-utils.js', () => {
  const from = (table: string) => {
    let rows = db[table] || [];
    let columns: string[] = [];
    const query: any = {
      select: (list: string) => { columns = list.split(',').map((c) => c.trim()); return query; },
      eq: (col: string, value: unknown) => { rows = rows.filter((r) => r[col] === value); return query; },
      in: (col: string, values: unknown[]) => { rows = rows.filter((r) => values.includes(r[col])); return query; },
      maybeSingle: async () => ({ data: pick(rows)[0] || null, error: null }),
      then: (resolve: any) => resolve({ data: pick(rows), error: null }),
    };
    // Return only the selected columns, so a restriction column missing from the
    // select list fails the test just as it would in production.
    const pick = (list: any[]) => list.map((r) => Object.fromEntries(columns.map((c) => [c, r[c]])));
    return query;
  };
  return {
    headers: {},
    jsonResponse: (statusCode: number, body: unknown) => ({ statusCode, body: JSON.stringify(body) }),
    adminClient: { from },
    isPlainObject: (v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v),
    mergeGlobalSourcingMetadata: () => ({}),
    extractGlobalSourcingFromSupabaseMeta: () => null,
  };
});
vi.mock('../../netlify/functions/services/rate-limit.js', () => ({
  checkRateLimit: async () => ({ limited: false }),
}));
vi.mock('../../netlify/functions/services/customerAuth.js', () => ({
  authenticateCustomer: async () => ({ userId: null }),
}));

// @ts-ignore - plain JS module
const { handler } = await import('../../netlify/functions/create-order.js');

async function quote(voucher: object, productIds = db.products.map((p) => p.id)) {
  db.campaign_vouchers = [{ id: 'v1', code: 'TEST', status: 'active', max_uses: 10, current_uses: 0, ...voucher }];
  const res = await handler({
    httpMethod: 'POST',
    headers: {},
    body: JSON.stringify({
      quote_only: true,
      voucher_code: 'TEST',
      shipping_fee: 2000,
      items: productIds.map((product_id) => ({ product_id, quantity: 1 })),
    }),
  });
  return { status: res.statusCode, ...JSON.parse(res.body) };
}

describe('create-order voucher restrictions', () => {
  it('charges for other items beside a free-product voucher', async () => {
    const res = await quote({ discount_type: 'free', discount_value: 0, product_skus: ['HOM-VIK-046'] });
    expect(res.quote).toMatchObject({ subtotal: 140000, discount_amount: 40000, total_amount: 102000 });
  });

  it('applies a vendor voucher to that vendor only', async () => {
    const res = await quote({ discount_type: 'percentage', discount_value: 20, vendor_ids: ['vendor-a'] });
    expect(res.quote.discount_amount).toBe(8000);
  });

  it('applies a category voucher to that category only', async () => {
    const res = await quote({ discount_type: 'percentage', discount_value: 10, category_ids: ['cat-phones'] });
    expect(res.quote.discount_amount).toBe(10000);
  });

  it('rejects a cart with nothing eligible', async () => {
    const res = await quote(
      { discount_type: 'free', discount_value: 0, product_skus: ['HOM-VIK-046'] },
      ['22222222-2222-2222-2222-222222222222'],
    );
    expect(res.status).toBe(400);
  });

  it('keeps unrestricted vouchers on the whole cart', async () => {
    const res = await quote({ discount_type: 'percentage', discount_value: 20 });
    expect(res.quote.discount_amount).toBe(28000);
  });
});
