import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { callSupabaseFunction, callSupabaseFunctionWithQuery } from '../../../lib/supabaseFunctions';
import { useAuth } from '../../contexts/AuthContext';
import { OrderCard, type OrderCardOrder } from '../OrderCard';
import { OrderSheet, type OrderSheetOrder } from '../OrderSheet';

interface Stats {
  totalOrders: number;
  activeHubs: number;
  activeCouriers: number;
  avgDeliveryTime: number;
}

const RECENT_ORDERS_SHOWN = 5;
const functionsBase = import.meta.env.VITE_NETLIFY_FUNCTIONS_BASE || '/.netlify/functions';

function formatStat(value: number | undefined | null): string {
  if (value == null) return '—';
  return new Intl.NumberFormat('en-NG').format(value);
}

export default function MobileHome() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Stats | null>(null);
  const [orders, setOrders] = useState<OrderSheetOrder[]>([]);
  const [pendingRefunds, setPendingRefunds] = useState<number | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<OrderSheetOrder | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [statsRes, ordersRes, returnsRes] = await Promise.all([
        callSupabaseFunction('stats', { method: 'GET' }),
        callSupabaseFunctionWithQuery('orders', { limit: '200', offset: '0' }, { method: 'GET' }),
        fetch(`${functionsBase}/returns-queue`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);

      if (statsRes?.data) setStats(statsRes.data);
      if (Array.isArray(ordersRes?.data)) setOrders(ordersRes.data);
      if (returnsRes?.stats) setPendingRefunds(returnsRes.stats.pending_review ?? 0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const inTransitCount = orders.filter((o) => o.overall_status === 'in_transit').length;
  const recentOrders = orders.slice(0, RECENT_ORDERS_SHOWN);

  if (loading) {
    return (
      <div className="space-y-3 p-4">
        <div className="grid grid-cols-2 gap-2.5">
          <div className="h-[74px] animate-pulse rounded-lg bg-gray-100" />
          <div className="h-[74px] animate-pulse rounded-lg bg-gray-100" />
        </div>
        <div className="h-16 animate-pulse rounded-lg bg-gray-100" />
        <div className="h-16 animate-pulse rounded-lg bg-gray-100" />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      <div>
        <h1 className="text-lg font-bold text-gray-900">
          {user?.full_name ? `Hi, ${user.full_name.split(' ')[0]}` : 'Dashboard'}
        </h1>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <div className="text-2xl font-bold tabular-nums text-gray-900">{formatStat(stats?.totalOrders)}</div>
          <div className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-gray-400">Total orders</div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <div className="text-2xl font-bold tabular-nums text-gray-900">{formatStat(inTransitCount)}</div>
          <div className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-gray-400">In transit</div>
        </div>
      </div>

      <div>
        <p className="mb-1.5 px-0.5 text-[11px] font-medium uppercase tracking-wide text-gray-400">Needs you</p>
        {pendingRefunds === null ? (
          <div className="h-14 animate-pulse rounded-lg bg-gray-100" />
        ) : pendingRefunds > 0 ? (
          <button
            type="button"
            onClick={() => navigate('/admin/refunds')}
            className="flex w-full items-center gap-3 rounded-lg border border-gray-200 border-l-[3px] border-l-orange-500 bg-white p-3 text-left"
          >
            <span className="text-lg font-bold tabular-nums text-orange-600">{pendingRefunds}</span>
            <span className="flex-1 text-sm text-gray-900">
              {pendingRefunds === 1 ? 'Refund awaiting approval' : 'Refunds awaiting approval'}
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
          </button>
        ) : (
          <div className="rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-500">
            No refunds waiting on you right now.
          </div>
        )}
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between px-0.5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Recent orders</p>
          <button type="button" onClick={() => navigate('/admin/orders')} className="text-xs font-medium text-primary-600">
            See all
          </button>
        </div>
        {recentOrders.length === 0 ? (
          <div className="rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-500">No orders yet.</div>
        ) : (
          <div className="space-y-2">
            {recentOrders.map((order) => (
              <OrderCard
                key={order.id}
                order={order as OrderCardOrder}
                onTap={setSelectedOrder}
                selected={selectedOrder?.id === order.id}
              />
            ))}
          </div>
        )}
      </div>

      <OrderSheet order={selectedOrder} onClose={() => setSelectedOrder(null)} />
    </div>
  );
}
