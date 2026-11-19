import { describe, expect, it } from 'vitest';
import {
  presentConfig,
  readRewardsConfig,
  readRewardsSummary,
  readCustomerRewards,
  listReferralReview,
  // @ts-expect-error plain JS module
} from '../../netlify/functions/services/rewards-public-api.js';

const policy = {
  schema_version: 1,
  programme: { name: 'JulinePoints', enabled: true, timezone: 'Africa/Lagos', launch_at: '2026-11-18T00:00:00.000Z', points_to_ngn: 5 },
  signup: { enabled: true, points: 100, require_verified_email: true },
  daily_claim: { enabled: true, points: 5 },
  streak: { enabled: true, length_days: 7, bonus_points: 5, reset_policy: 'reset', grace_days: 0 },
  purchase: { enabled: true, rate_percent: 0.5, rounding: 'floor', hold_days: 7, max_points_per_order: null, include_points_funded_value: false },
  referral: {
    enabled: true, window_days: 30, hold_days: 7,
    tiers: [{ min_ngn: 1000, max_ngn: 21000, points: 20 }, { min_ngn: 51000, max_ngn: null, points: 100 }],
  },
  redemption: { enabled: true, cap_percent: 10, min_points: 1, partial_allowed: true, max_points_per_order: null },
  expiry: { enabled: false, days: 365, warn_days: 30 },
  adjustments: { dual_approval_threshold_points: 500 },
};
const cfg = { id: 'cfg-1', version: 9, effective_from: '2026-11-18T12:46:02Z', policy };

type Res = { data?: any; error?: any; count?: number };

// Minimal stand-in for the supabase client: every query chain resolves to the table's canned result.
function fakeClient(tables: Record<string, Res>, rpcs: Record<string, any> = { rewards_active_config: cfg }) {
  const calls: string[] = [];
  const builder = (table: string) => {
    const res = tables[table] ?? { data: [] };
    const b: any = {};
    for (const m of ['select', 'eq', 'neq', 'in', 'order', 'limit', 'range']) b[m] = () => b;
    b.maybeSingle = () =>
      Promise.resolve({ data: Array.isArray(res.data) ? res.data[0] ?? null : res.data ?? null, error: res.error ?? null });
    b.then = (ok: any, bad: any) =>
      Promise.resolve({
        data: res.data ?? null,
        error: res.error ?? null,
        count: res.count ?? (Array.isArray(res.data) ? res.data.length : null),
      }).then(ok, bad);
    return b;
  };
  return {
    calls,
    from: (t: string) => { calls.push(`from:${t}`); return builder(t); },
    rpc: (n: string) => { calls.push(`rpc:${n}`); return Promise.resolve({ data: rpcs[n], error: null }); },
  };
}

describe('presentConfig', () => {
  it('exposes the live numbers but not the staff adjustment threshold', () => {
    const out = presentConfig(cfg);
    expect(out.programme.points_to_ngn).toBe(5);
    expect(out.signup.points).toBe(100);
    expect(out.purchase.rate_percent).toBe(0.5);
    expect(out.referral.tiers).toHaveLength(2);
    expect(out.referral.tiers[1].max_ngn).toBeNull();
    expect(JSON.stringify(out)).not.toContain('dual_approval');
    expect(out.version).toBe(9);
  });
});

describe('readRewardsConfig', () => {
  it('reports disabled when there is no active config', async () => {
    const r = await readRewardsConfig(fakeClient({}, { rewards_active_config: null }));
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({ enabled: false, version: null });
  });
});

describe('readRewardsSummary', () => {
  it('returns totals with naira values and the review and drift counts', async () => {
    const client = fakeClient({
      rewards_cost_summary: {
        data: [{ issued_points: '1000', issued_ngn: '5000', redeemed_points: '200', redeemed_ngn: '1000', restored_points: '0', restored_ngn: '0', adjusted_points: '0', expired_points: '0', outstanding_points: '800', pending_points: '40' }],
      },
      rewards_accounts: { data: null, count: 103 },
      rewards_reconciliation: { data: null, count: 0 },
      rewards_referral_awards: { data: null, count: 2 },
    });
    const r = await readRewardsSummary(client);
    expect(r.status).toBe(200);
    expect(r.body.data.accounts).toBe(103);
    expect(r.body.data.outstanding_points).toBe(800);
    expect(r.body.data.outstanding_ngn).toBe(4000);
    expect(r.body.data.pending_ngn).toBe(200);
    expect(r.body.data.referrals_awaiting_review).toBe(2);
    expect(r.body.data.balance_drift_accounts).toBe(0);
  });

  it('surfaces a database error instead of zeros', async () => {
    const r = await readRewardsSummary(fakeClient({ rewards_cost_summary: { data: null, error: { message: 'boom' } } }));
    expect(r.status).toBe(500);
  });
});

describe('readCustomerRewards', () => {
  const customer = { id: 'u1', first_name: 'Ada', last_name: 'Obi', phone: '0800', email: 'secret@example.com' };

  it('computes available and pending, anonymises friends, and never returns email', async () => {
    const client = fakeClient(
      {
        rewards_accounts: { data: [{ balance_points: 120, reserved_points: 20, lifetime_earned_points: 300, referral_code: 'ADA123', created_at: '2026-11-18' }] },
        rewards_ledger: { data: [{ id: 'l1', entry_type: 'signup', points: 100, source: 'signup', reference_type: null, reference_id: null, reason: null, created_at: '2026-11-18' }] },
        rewards_purchase_awards: { data: [{ points: 30 }] },
        rewards_referral_awards: { data: [{ referee_id: 'f1', points: 40, status: 'in_review' }] },
        rewards_daily_claims: { data: [] },
        rewards_referrals: { data: [{ referee_id: 'f1', attributed_at: '2026-11-19' }, { referee_id: 'f2', attributed_at: '2026-11-18' }], count: 0 },
        rewards_referral_attempts: { data: [] },
        rewards_reservations: { data: [{ order_id: 'o1', points: 20, expires_at: '2026-11-19T12:00:00Z', status: 'reserved' }] },
      },
      { rewards_active_config: cfg, rewards_is_storefront_customer: true },
    );
    const r = await readCustomerRewards(client, customer);
    const d = r.body.data;
    expect(r.status).toBe(200);
    expect(d.wallet.available_points).toBe(100);
    expect(d.wallet.available_ngn).toBe(500);
    expect(d.wallet.pending_points).toBe(70); // 30 purchase + 40 referral in review
    expect(d.open_holds).toHaveLength(1);
    expect(d.referral.code).toBe('ADA123');
    expect(d.referral.friends.map((f: any) => f.label)).toEqual(['Friend 1', 'Friend 2']);
    expect(d.referral.pending_count).toBe(2);
    expect(JSON.stringify(r.body)).not.toContain('secret@example.com');
    expect(JSON.stringify(r.body)).not.toContain('f1');
  });

  it('reports no wallet instead of creating one', async () => {
    const client = fakeClient({}, { rewards_active_config: cfg, rewards_is_storefront_customer: true });
    const r = await readCustomerRewards(client, customer);
    expect(r.body.data.wallet).toBeNull();
    expect(r.body.data.wallet_note).toMatch(/No wallet yet/);
  });

  it('is read-only: it only calls the two read RPCs and never a write RPC', async () => {
    const client = fakeClient({}, { rewards_active_config: cfg, rewards_is_storefront_customer: true });
    await readCustomerRewards(client, customer);
    const rpcs = client.calls.filter((c: string) => c.startsWith('rpc:'));
    expect(rpcs.sort()).toEqual(['rpc:rewards_active_config', 'rpc:rewards_is_storefront_customer']);
  });

  it('says not eligible for staff or vendor accounts', async () => {
    const client = fakeClient({}, { rewards_active_config: cfg, rewards_is_storefront_customer: false });
    const r = await readCustomerRewards(client, customer);
    expect(r.body.data.eligible).toBe(false);
    expect(r.body.data.wallet).toBeUndefined();
  });

  it('reports the programme as disabled when there is no active config', async () => {
    const r = await readCustomerRewards(fakeClient({}, { rewards_active_config: null }), customer);
    expect(r.body.data.programme_enabled).toBe(false);
  });
});

describe('listReferralReview', () => {
  it('rejects an unknown status', async () => {
    const r = await listReferralReview(fakeClient({}), { status: 'bogus' });
    expect(r.status).toBe(400);
  });

  it('names both sides, keeps only string flags, and carries no phone or address', async () => {
    const A = '11111111-1111-1111-1111-111111111111';
    const B = '22222222-2222-2222-2222-222222222222';
    const client = fakeClient({
      rewards_referral_awards: {
        data: [{ id: 'a1', referrer_id: A, referee_id: B, order_id: 'o1', qualifying_amount: '25000', points: 40, status: 'in_review', void_reason: null, signals: ['same_phone_as_referrer', { x: 1 }, 5], created_at: '2026-11-19', vested_at: null, reviewed_at: null }],
        count: 1,
      },
      customers: { data: [{ id: A, first_name: 'Ada', last_name: 'Obi' }, { id: B, first_name: 'Chi', last_name: null }] },
    });
    const r = await listReferralReview(client, {});
    const row = r.body.data[0];
    expect(row.referrer.name).toBe('Ada Obi');
    expect(row.referee.name).toBe('Chi');
    expect(row.signals).toEqual(['same_phone_as_referrer']);
    expect(row.qualifying_amount).toBe(25000);
    expect(row).not.toHaveProperty('phone');
    expect(r.body.count).toBe(1);
  });
});
