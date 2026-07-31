import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import { callSupabaseFunctionWithQuery } from '../../../lib/supabaseFunctions';
import { OrderCard, type OrderCardOrder } from '../OrderCard';
import { OrderSheet, type OrderSheetOrder } from '../OrderSheet';
import { PullToRefresh } from '../PullToRefresh';
import { orderDisplayLabel } from '../lib/orderDisplay';

const STATUS_FILTERS: Array<{ key: string; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'vendor_dispatched', label: 'Vendor dispatched' },
  { key: 'processing', label: 'Processing' },
  { key: 'in_transit', label: 'In transit' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'cancelled', label: 'Cancelled' },
];

export default function MobileOrders() {
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<OrderSheetOrder[]>([]);
  const [search, setSearch] = useState(() => searchParams.get('search') || '');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedOrder, setSelectedOrder] = useState<OrderSheetOrder | null>(null);

  const fetchOrders = useCallback(async () => {
    try {
      const res = await callSupabaseFunctionWithQuery('orders', { limit: '200', offset: '0' }, { method: 'GET' });
      if (Array.isArray(res?.data)) setOrders(res.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const q = searchParams.get('search');
    if (q) setSearch(q);
  }, [searchParams]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const counts = useMemo(() => {
    const map: Record<string, number> = { all: orders.length };
    for (const order of orders) {
      map[order.overall_status] = (map[order.overall_status] || 0) + 1;
    }
    return map;
  }, [orders]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter((order) => {
      const matchesStatus = statusFilter === 'all' || order.overall_status === statusFilter;
      if (!matchesStatus) return false;
      if (!q) return true;
      return (
        order.customer_name?.toLowerCase().includes(q) ||
        (order as { customer_email?: string }).customer_email?.toLowerCase().includes(q) ||
        orderDisplayLabel(order).toLowerCase().includes(q)
      );
    });
  }, [orders, search, statusFilter]);

  return (
    <>
      <PullToRefresh onRefresh={fetchOrders}>
      <div className="sticky top-0 z-10 space-y-2.5 bg-gray-50 px-4 pb-3 pt-3">
        <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2.5">
          <Search className="h-4 w-4 shrink-0 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Order number or name"
            className="w-full bg-transparent text-sm text-gray-900 outline-none placeholder:text-gray-400"
            style={{ fontSize: '16px' }}
          />
        </div>

        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4">
          {STATUS_FILTERS.map((filter) => {
            const active = statusFilter === filter.key;
            const count = counts[filter.key] ?? 0;
            if (filter.key !== 'all' && count === 0) return null;
            return (
              <button
                key={filter.key}
                type="button"
                onClick={() => setStatusFilter(filter.key)}
                aria-pressed={active}
                className={`whitespace-nowrap rounded-full border px-3 py-2 font-mono text-[11px] ${
                  active ? 'border-primary-600 bg-primary-600 text-white' : 'border-gray-200 bg-white text-gray-600'
                }`}
              >
                {filter.label} {count}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2 p-4 pt-0">
        {loading ? (
          <>
            <div className="h-[76px] animate-pulse rounded-lg bg-gray-100" />
            <div className="h-[76px] animate-pulse rounded-lg bg-gray-100" />
            <div className="h-[76px] animate-pulse rounded-lg bg-gray-100" />
          </>
        ) : filtered.length === 0 ? (
          <div className="rounded-lg border border-gray-200 bg-white p-4 text-center text-sm text-gray-500">
            No orders match.
          </div>
        ) : (
          filtered.map((order) => (
            <OrderCard key={order.id} order={order as OrderCardOrder} onTap={setSelectedOrder} />
          ))
        )}
      </div>
      </PullToRefresh>

      <OrderSheet order={selectedOrder} onClose={() => setSelectedOrder(null)} />
    </>
  );
}
