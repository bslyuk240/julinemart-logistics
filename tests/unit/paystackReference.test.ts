import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error plain JS module
import {
  baseReference,
  isSafeReference,
  resolveOrderReference,
  resolveTransactionRef,
} from '../../netlify/functions/services/paystack-reference.js';

/** Minimal chainable stand-in for the supabase-js query builder. */
function fakeClient(rows: Record<string, any>[]) {
  const updates: any[] = [];
  const builder = (table: string) => {
    let filter: ((r: any) => boolean) | null = null;
    const api: any = {
      select: () => api,
      limit: () => api,
      eq: (col: string, val: any) => { const prev = filter; filter = (r) => (prev ? prev(r) : true) && r[col] === val; return api; },
      or: (expr: string) => {
        const parts = expr.split(',').map((p) => p.split('.eq.'));
        filter = (r) => parts.some(([c, v]) => r[c] === v);
        return api;
      },
      maybeSingle: async () => ({ data: rows.find(filter || (() => true)) || null }),
      update: (patch: any) => ({ eq: async (_c: string, id: any) => { updates.push({ id, patch }); return {}; } }),
    };
    return api;
  };
  return { from: builder, updates };
}

describe('reference helpers', () => {
  it('strips only the fresh-attempt suffix', () => {
    expect(baseReference('JLO-MWLUX7BL-YL7T-RMWLUX915')).toBe('JLO-MWLUX7BL-YL7T');
    expect(baseReference('JLO-MWLUX7BL-YL7T')).toBe('JLO-MWLUX7BL-YL7T');
    expect(baseReference('JLO-MWLUX7BL-R4AB')).toBe('JLO-MWLUX7BL-R4AB'); // 4-char random part is not a suffix
  });

  it('rejects references that could alter a filter', () => {
    expect(isSafeReference('JLO-ABC-1234')).toBe(true);
    expect(isSafeReference('x,payment_status.eq.paid')).toBe(false);
    expect(isSafeReference('a(b)')).toBe(false);
  });
});

describe('resolveOrderReference (webhook side)', () => {
  const rows = [{ payment_reference: 'JLO-AAA-1111', paystack_reference: 'JLO-AAA-1111-RXYZ12345' }];

  it('matches the stored paystack_reference', async () => {
    expect(await resolveOrderReference(fakeClient(rows), 'JLO-AAA-1111-RXYZ12345')).toBe('JLO-AAA-1111');
  });
  it('matches a plain payment_reference', async () => {
    expect(await resolveOrderReference(fakeClient(rows), 'JLO-AAA-1111')).toBe('JLO-AAA-1111');
  });
  it('falls back to the suffix-stripped base when nothing is stored yet', async () => {
    const c = fakeClient([{ payment_reference: 'JLO-BBB-2222', paystack_reference: null }]);
    expect(await resolveOrderReference(c, 'JLO-BBB-2222-RQWERTY99')).toBe('JLO-BBB-2222');
  });
  it('returns the input when no order matches', async () => {
    expect(await resolveOrderReference(fakeClient([]), 'JLO-ZZZ-0000-RABCDE123')).toBe('JLO-ZZZ-0000-RABCDE123');
  });
});

describe('resolveTransactionRef (refund side)', () => {
  const json = (body: any) => ({ json: async () => body });

  it('uses the stored paystack_reference without calling Paystack', async () => {
    const fetchImpl = vi.fn();
    const c = fakeClient([{ id: 1, payment_reference: 'JLO-A-1', paystack_reference: 'JLO-A-1-RAAAAA111' }]);
    expect(await resolveTransactionRef(c, 'JLO-A-1', 'sk', fetchImpl)).toBe('JLO-A-1-RAAAAA111');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('keeps the reference when Paystack already knows it', async () => {
    const fetchImpl = vi.fn(async () => json({ status: true, data: { status: 'success' } }));
    const c = fakeClient([{ id: 1, payment_reference: 'JLO-A-1', paystack_reference: null, total_amount: 100 }]);
    expect(await resolveTransactionRef(c, 'JLO-A-1', 'sk', fetchImpl as any)).toBe('JLO-A-1');
  });

  it('finds an older order\'s suffixed transaction by amount and date, and remembers it', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      String(url).includes('/transaction/verify/')
        ? json({ status: false })
        : json({ status: true, data: [{ reference: 'OTHER-1' }, { reference: 'JLO-A-1-RZZZZ9999' }] }));
    const c = fakeClient([{ id: 7, payment_reference: 'JLO-A-1', paystack_reference: null, total_amount: 27750, paid_at: '2026-11-18T09:00:00Z' }]);
    expect(await resolveTransactionRef(c, 'JLO-A-1', 'sk', fetchImpl as any)).toBe('JLO-A-1-RZZZZ9999');
    expect(c.updates).toEqual([{ id: 7, patch: { paystack_reference: 'JLO-A-1-RZZZZ9999' } }]);
    const listUrl = String((fetchImpl.mock.calls as any[]).find((x) => !String(x[0]).includes('/verify/'))![0]);
    expect(listUrl).toContain('amount=2775000');
  });

  it('falls back to the input when nothing is found or there is no secret', async () => {
    const c = fakeClient([{ id: 1, payment_reference: 'JLO-A-1', paystack_reference: null, total_amount: 100 }]);
    const fetchImpl = vi.fn(async () => json({ status: false, data: [] }));
    expect(await resolveTransactionRef(c, 'JLO-A-1', 'sk', fetchImpl as any)).toBe('JLO-A-1');
    expect(await resolveTransactionRef(c, 'JLO-A-1', '', fetchImpl as any)).toBe('JLO-A-1');
  });
});
