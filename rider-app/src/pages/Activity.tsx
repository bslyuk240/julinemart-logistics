import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Package, RefreshCw, RotateCcw, XCircle } from 'lucide-react';
import { api, ActivityItem, ActivityStatusFilter } from '../lib/api';
import { BottomNav } from '../components/BottomNav';

function formatNaira(amount: number) {
  return `₦${amount.toLocaleString('en-NG', { maximumFractionDigits: 0 })}`;
}

const FILTERS: { key: ActivityStatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'In progress' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'failed', label: 'Failed' },
  { key: 'returned', label: 'Returned' },
];

const STATUS_LABEL: Record<ActivityItem['status'], string> = {
  assigned: 'Assigned',
  picked_up: 'Picked up',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  failed: 'Failed',
  returned: 'Returned',
};

const STATUS_ICON: Record<ActivityItem['status'], typeof CheckCircle2> = {
  assigned: Package,
  picked_up: Package,
  out_for_delivery: Package,
  delivered: CheckCircle2,
  failed: XCircle,
  returned: RotateCcw,
};

const STATUS_CLASS: Record<ActivityItem['status'], string> = {
  assigned: 'bg-blue-100 text-blue-700',
  picked_up: 'bg-indigo-100 text-indigo-700',
  out_for_delivery: 'bg-amber-100 text-amber-700',
  delivered: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-red-100 text-red-700',
  returned: 'bg-gray-100 text-gray-600',
};

export default function Activity() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<ActivityStatusFilter>('all');
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (status: ActivityStatusFilter) => {
    setLoading(true);
    try {
      const data = await api.getActivity(status);
      setItems(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load activity');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(filter);
  }, [filter, load]);

  return (
    <div className="min-h-screen pb-24">
      <div className="px-6 pt-4 pb-4 bg-white border-b border-gray-100 flex items-center gap-3">
        <button type="button" onClick={() => navigate('/')} className="text-gray-400">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-base font-bold text-gray-900">Activity</h1>
      </div>

      <div className="px-6 pt-4">
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold ${
                filter === f.key ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-700'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-6 pt-4 space-y-3">
        {error && <p className="text-sm text-red-600">{error}</p>}

        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <RefreshCw className="w-5 h-5 animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-300 p-6 text-center">
            <Package className="w-6 h-6 text-gray-300 mx-auto mb-2" />
            <p className="text-sm font-semibold text-gray-900">Nothing here yet</p>
            <p className="mt-1 text-xs text-gray-500">Deliveries in this filter will show up here.</p>
          </div>
        ) : (
          items.map((item) => {
            const Icon = STATUS_ICON[item.status];
            return (
              <div key={item.id} className="rounded-2xl border border-gray-200 p-4 flex items-start gap-3">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${STATUS_CLASS[item.status]}`}>
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-gray-900 truncate">
                      {item.tracking_number || `Order ${item.order_number ?? ''}`}
                    </p>
                    <p className="text-sm font-bold text-gray-900 shrink-0">{formatNaira(item.fee)}</p>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5 truncate">
                    {item.customer_name || 'Customer'}{item.dropoff_city ? ` · ${item.dropoff_city}` : ''}
                  </p>
                  <div className="flex items-center justify-between mt-1.5">
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${STATUS_CLASS[item.status]}`}>
                      {STATUS_LABEL[item.status]}
                    </span>
                    <span className="text-[11px] text-gray-400">
                      {new Date(item.timestamp).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })}
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <BottomNav />
    </div>
  );
}
