import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Loader } from 'lucide-react';
import { useNotification } from '../../contexts/NotificationContext';
import { PullToRefresh } from '../PullToRefresh';
import { Sheet } from '../Sheet';
import { SectionLabel } from '../components/MobileDetailParts';
import { TABBAR_SPACE } from '../lib/functionsAuth';
import { formatNaira } from '../lib/displayUtils';
import { influencerFetch } from '../lib/marketingApi';

interface Influencer {
  id: string;
  name: string;
  email: string;
  phone: string;
  platform: string;
  handle: string;
  coupon_code: string;
  shipping_discount_type: string;
  shipping_discount_value: number;
  minimum_order_value: number;
  commission_rate: number;
  tier: string;
  status: string;
  total_orders: number;
  total_sales: number;
  total_commission_earned: number;
  total_commission_paid: number;
  total_shipping_discounts: number;
  last_sale_date: string;
  created_at: string;
}

interface Sale {
  id: string;
  order_number: string;
  customer_email: string;
  product_total: number;
  influencer_commission_amount: number;
  commission_status: string;
  sale_date: string;
  order_status: string;
}

const PERIODS = [
  { key: 'this_month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'all_time', label: 'All time' },
];

export default function MobileInfluencerDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const notification = useNotification();
  const [influencer, setInfluencer] = useState<Influencer | null>(null);
  const [sales, setSales] = useState<Sale[]>([]);
  const [period, setPeriod] = useState('this_month');
  const [loading, setLoading] = useState(true);
  const [payOpen, setPayOpen] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payRef, setPayRef] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [infRes, salesRes] = await Promise.all([
        influencerFetch<{ success?: boolean; data?: Influencer }>(`/influencers/${id}`),
        influencerFetch<{ success?: boolean; data?: Sale[] }>(`/influencers/${id}/sales?period=${period}`),
      ]);
      if (infRes.success) setInfluencer(infRes.data || null);
      if (salesRes.success) setSales(salesRes.data || []);
    } catch {
      notification.error('Load failed', 'Unable to load influencer');
    } finally {
      setLoading(false);
    }
  }, [id, notification, period]);

  useEffect(() => {
    load();
  }, [load]);

  const pay = async () => {
    if (!id) return;
    const amount = Number(payAmount);
    if (!amount || amount <= 0) return;
    setSubmitting(true);
    try {
      const res = await influencerFetch<{ success?: boolean; error?: string }>(`/influencers/${id}/pay`, {
        method: 'POST',
        body: JSON.stringify({ amount, payment_reference: payRef.trim() || undefined }),
      });
      if (!res.success) throw new Error(res.error || 'Failed');
      notification.success('Paid', 'Commission recorded');
      setPayOpen(false);
      load();
    } catch (err) {
      notification.error('Payment failed', err instanceof Error ? err.message : 'Unable to pay');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Loader className="h-6 w-6 animate-spin text-primary-600" />
      </div>
    );
  }

  if (!influencer) {
    return <div className="p-4 text-center text-sm text-gray-500">Influencer not found.</div>;
  }

  const pending = influencer.total_commission_earned - influencer.total_commission_paid;

  return (
    <>
      <PullToRefresh onRefresh={load}>
        <div className="space-y-3 p-4" style={{ paddingBottom: TABBAR_SPACE }}>
          <button type="button" onClick={() => navigate('/admin/influencers')} className="flex items-center gap-1 text-sm text-primary-600">
            <ArrowLeft className="h-4 w-4" /> Influencers
          </button>

          <div className="flex items-center gap-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-purple-100 text-xl font-bold text-purple-600">
              {influencer.name.charAt(0)}
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900">{influencer.name}</h1>
              <p className="text-xs text-gray-500">
                {influencer.platform} · @{influencer.handle} · {influencer.coupon_code}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-white p-3 ring-1 ring-gray-100">
              <p className="text-[10px] uppercase text-gray-400">Orders</p>
              <p className="text-lg font-bold">{influencer.total_orders}</p>
            </div>
            <div className="rounded-xl bg-white p-3 ring-1 ring-gray-100">
              <p className="text-[10px] uppercase text-gray-400">Sales</p>
              <p className="text-sm font-bold">{formatNaira(influencer.total_sales)}</p>
            </div>
            <div className="rounded-xl bg-white p-3 ring-1 ring-gray-100">
              <p className="text-[10px] uppercase text-gray-400">Earned</p>
              <p className="text-sm font-bold">{formatNaira(influencer.total_commission_earned)}</p>
            </div>
            <div className="rounded-xl bg-white p-3 ring-1 ring-gray-100">
              <p className="text-[10px] uppercase text-gray-400">Pending</p>
              <p className="text-sm font-bold text-green-700">{formatNaira(pending)}</p>
            </div>
          </div>

          {pending > 0 && (
            <button type="button" onClick={() => { setPayOpen(true); setPayAmount(String(Math.round(pending))); }} className="w-full rounded-xl bg-green-600 py-3 text-sm font-semibold text-white">
              Pay {formatNaira(pending)} commission
            </button>
          )}

          <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4">
            {PERIODS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setPeriod(key)}
                className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-[10px] font-medium ${
                  period === key ? 'border-primary-600 bg-primary-600 text-white' : 'border-gray-200 bg-white text-gray-600'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <SectionLabel>{sales.length} sales</SectionLabel>
          {sales.length === 0 ? (
            <div className="rounded-xl bg-white p-4 text-sm text-gray-500 ring-1 ring-gray-100">No sales in this period.</div>
          ) : (
            <div className="space-y-2">
              {sales.map((s) => (
                <div key={s.id} className="rounded-xl bg-white p-3 ring-1 ring-gray-100">
                  <div className="flex justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">#{s.order_number}</p>
                      <p className="text-xs text-gray-500">{s.customer_email}</p>
                      <p className="text-xs text-gray-400">{new Date(s.sale_date).toLocaleDateString()}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold">{formatNaira(s.product_total)}</p>
                      <p className="text-xs text-green-700">+{formatNaira(s.influencer_commission_amount)}</p>
                      <span className="text-[10px] text-gray-400">{s.commission_status}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </PullToRefresh>

      <Sheet open={payOpen} onClose={() => setPayOpen(false)} ariaLabel="Pay commission">
        <h3 className="text-base font-bold">Record payment</h3>
        <input type="number" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" style={{ fontSize: '16px' }} />
        <input value={payRef} onChange={(e) => setPayRef(e.target.value)} placeholder="Reference (optional)" className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" style={{ fontSize: '16px' }} />
        <button type="button" disabled={submitting} onClick={() => void pay()} className="w-full rounded-xl bg-green-600 py-3 text-sm font-semibold text-white disabled:opacity-60">
          {submitting ? 'Saving…' : 'Confirm payment'}
        </button>
      </Sheet>
    </>
  );
}
