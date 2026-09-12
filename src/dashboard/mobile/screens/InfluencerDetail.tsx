import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Loader, Send } from 'lucide-react';
import { useNotification } from '../../contexts/NotificationContext';
import { PullToRefresh } from '../PullToRefresh';
import { SectionLabel } from '../components/MobileDetailParts';
import { TABBAR_SPACE } from '../lib/functionsAuth';
import { formatNaira } from '../lib/displayUtils';
import { influencerFetch } from '../lib/marketingApi';
import { vendorPost } from '../lib/vendorApi';

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
  user_id: string | null;
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
  const [inviting, setInviting] = useState(false);

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

          {influencer.email && (
            <button
              type="button"
              disabled={inviting}
              onClick={async () => {
                setInviting(true);
                const res = await vendorPost<{ success?: boolean; message?: string; error?: string }>('influencer-invite', {
                  influencer_id: influencer.id,
                });
                setInviting(false);
                if (res.success) {
                  notification.success('Invite sent', res.message || 'Influencer invite sent');
                  load();
                } else {
                  notification.error('Invite failed', res.message || res.error || 'Unable to send invite');
                }
              }}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-purple-200 bg-purple-50 py-3 text-sm font-semibold text-purple-700 disabled:opacity-50"
            >
              {inviting ? <Loader className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {influencer.user_id ? 'Resend Portal Invite' : 'Send Portal Invite'}
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
    </>
  );
}
