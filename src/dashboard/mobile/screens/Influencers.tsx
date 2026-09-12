import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Loader, Plus, Send, Users } from 'lucide-react';
import { useNotification } from '../../contexts/NotificationContext';
import { PullToRefresh } from '../PullToRefresh';
import { Sheet } from '../Sheet';
import { TABBAR_SPACE } from '../lib/functionsAuth';
import { formatNaira } from '../lib/displayUtils';
import { fmtNgn, influencerFetch } from '../lib/marketingApi';
import { vendorPost } from '../lib/vendorApi';

interface Influencer {
  id: string;
  name: string;
  email: string;
  phone: string;
  platform: string;
  handle: string;
  coupon_code: string;
  commission_rate: number;
  tier: string;
  status: string;
  total_orders: number;
  total_sales: number;
  total_commission_earned: number;
  total_commission_paid: number;
  user_id: string | null;
}

export default function MobileInfluencers() {
  const navigate = useNavigate();
  const notification = useNotification();
  const [rows, setRows] = useState<Influencer[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [inviting, setInviting] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    platform: 'instagram',
    handle: '',
    coupon_code: '',
    shipping_discount_type: 'percentage',
    shipping_discount_value: 50,
    minimum_order_value: 0,
    commission_rate: 5,
    tier: 'TIER1',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await influencerFetch<{ success?: boolean; data?: Influencer[]; error?: string }>('/influencers?status=active');
      if (res.success) setRows(res.data || []);
      else notification.error('Load failed', res.error || 'Unable to load influencers');
    } catch (err) {
      notification.error('Load failed', err instanceof Error ? err.message : 'Unable to load influencers');
    } finally {
      setLoading(false);
    }
  }, [notification]);

  useEffect(() => {
    load();
  }, [load]);

  const stats = useMemo(() => {
    const commissionOwed = rows.reduce((s, i) => s + (i.total_commission_earned - i.total_commission_paid), 0);
    return { count: rows.length, owed: commissionOwed };
  }, [rows]);

  const create = async () => {
    if (!form.name.trim() || !form.coupon_code.trim()) {
      notification.error('Validation', 'Name and coupon code are required');
      return;
    }
    setSubmitting(true);
    try {
      const res = await influencerFetch<{ success?: boolean; error?: string }>('/influencers', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      if (!res.success) throw new Error(res.error || 'Failed to create');
      notification.success('Created', 'Influencer added');
      setAddOpen(false);
      load();
    } catch (err) {
      notification.error('Create failed', err instanceof Error ? err.message : 'Unable to create');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <PullToRefresh onRefresh={load}>
        <div className="space-y-3 p-4" style={{ paddingBottom: TABBAR_SPACE }}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <h1 className="text-lg font-bold text-gray-900">Influencers</h1>
              <p className="text-xs text-gray-500">Affiliate partnerships</p>
            </div>
            <button type="button" onClick={() => setAddOpen(true)} className="flex items-center gap-1 rounded-lg bg-primary-600 px-3 py-2 text-xs font-semibold text-white">
              <Plus className="h-3.5 w-3.5" /> Add
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-white p-3 ring-1 ring-gray-100">
              <p className="text-[10px] uppercase text-gray-400">Active</p>
              <p className="text-lg font-bold">{stats.count}</p>
            </div>
            <div className="rounded-xl bg-white p-3 ring-1 ring-gray-100">
              <p className="text-[10px] uppercase text-gray-400">Commission owed</p>
              <p className="text-sm font-bold">{formatNaira(stats.owed)}</p>
            </div>
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <Loader className="h-6 w-6 animate-spin text-primary-600" />
            </div>
          ) : rows.length === 0 ? (
            <div className="rounded-xl bg-white p-6 text-center text-sm text-gray-500 ring-1 ring-gray-100">
              <Users className="mx-auto mb-2 h-8 w-8 text-gray-300" />
              No influencers yet.
            </div>
          ) : (
            <div className="space-y-2">
              {rows.map((i) => {
                return (
                  <div key={i.id} className="rounded-xl bg-white p-3 ring-1 ring-gray-100">
                    <button type="button" onClick={() => navigate(`/admin/influencers/${i.id}`)} className="flex w-full items-center gap-3 text-left">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-purple-100 text-sm font-bold text-purple-600">
                        {i.name.charAt(0)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-gray-900">{i.name}</p>
                        <p className="text-xs text-gray-500">{i.platform} · @{i.handle} · {i.coupon_code}</p>
                        <p className="text-xs text-gray-400">{i.total_orders} orders · {fmtNgn(i.total_sales)} sales</p>
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-gray-300" />
                    </button>
                    {i.email && (
                      <button
                        type="button"
                        disabled={inviting === i.id}
                        onClick={async () => {
                          setInviting(i.id);
                          const res = await vendorPost<{ success?: boolean; message?: string; error?: string }>('influencer-invite', {
                            influencer_id: i.id,
                          });
                          setInviting(null);
                          if (res.success) {
                            notification.success('Invite sent', res.message || 'Influencer invite sent');
                            load();
                          } else {
                            notification.error('Invite failed', res.message || res.error || 'Unable to send invite');
                          }
                        }}
                        className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg border border-purple-200 bg-purple-50 py-2 text-xs font-semibold text-purple-700 disabled:opacity-50"
                      >
                        {inviting === i.id ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                        {i.user_id ? 'Resend Portal Invite' : 'Send Portal Invite'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </PullToRefresh>

      <Sheet open={addOpen} onClose={() => setAddOpen(false)} ariaLabel="Add influencer">
        <h3 className="text-base font-bold">Add influencer</h3>
        <div className="space-y-3">
          <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Full name *" className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" style={{ fontSize: '16px' }} />
          <input value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="Email" className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" style={{ fontSize: '16px' }} />
          <input value={form.handle} onChange={(e) => setForm((f) => ({ ...f, handle: e.target.value }))} placeholder="Handle *" className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" style={{ fontSize: '16px' }} />
          <input value={form.coupon_code} onChange={(e) => setForm((f) => ({ ...f, coupon_code: e.target.value.toUpperCase() }))} placeholder="Coupon code *" className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm font-mono uppercase" style={{ fontSize: '16px' }} />
          <input type="number" value={form.commission_rate} onChange={(e) => setForm((f) => ({ ...f, commission_rate: Number(e.target.value) }))} placeholder="Commission %" className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" style={{ fontSize: '16px' }} />
        </div>
        <button type="button" disabled={submitting} onClick={() => void create()} className="mt-3 w-full rounded-xl bg-primary-600 py-3 text-sm font-semibold text-white disabled:opacity-60">
          {submitting ? 'Creating…' : 'Create influencer'}
        </button>
      </Sheet>
    </>
  );
}
