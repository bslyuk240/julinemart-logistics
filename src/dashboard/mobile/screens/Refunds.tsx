import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { PullToRefresh } from '../PullToRefresh';

const functionsBase = import.meta.env.VITE_NETLIFY_FUNCTIONS_BASE || '/.netlify/functions';

interface OrderPayment {
  order_number: string | number;
  total_amount: number;
  customer_name: string;
  customer_phone: string;
}

interface ReturnRequest {
  id: string;
  order_number: string;
  customer_name: string;
  status: string;
  reason_code: string;
  reason_note: string | null;
  refund_amount: number | null;
  created_at: string;
  order_payment: OrderPayment | null;
}

interface QueueStats {
  pending_review: number;
  approved: number;
  rejected: number;
}

const STATUS_FILTERS: Array<{ key: string; label: string }> = [
  { key: 'pending_review', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'all', label: 'All' },
];

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

// Same returns-queue endpoint and admin-approve-return action as Returns.tsx
// (the desktop page) — this only covers the pending_review gate (approve /
// reject). The deeper inspection and refund-amount workflow that happens
// after approval stays desktop-only for now, same reasoning as OrderDetails:
// it's a detail-heavy flow better suited to a bigger screen.
export default function MobileRefunds() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const notification = useNotification();
  const [items, setItems] = useState<ReturnRequest[]>([]);
  const [stats, setStats] = useState<QueueStats | null>(null);
  const [statusFilter, setStatusFilter] = useState('pending_review');
  const [loading, setLoading] = useState(true);

  const accessToken = session?.access_token;

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ status: statusFilter });
      const res = await fetch(`${functionsBase}/returns-queue?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || 'Failed to load returns');
      setItems(payload.data || []);
      setStats(payload.stats || null);
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Failed to load returns');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <PullToRefresh onRefresh={load}>
    <div>
      <div className="sticky top-0 z-10 bg-gray-50 px-4 pb-3 pt-3">
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4">
          {STATUS_FILTERS.map((filter) => {
            const active = statusFilter === filter.key;
            const count = filter.key === 'all' ? undefined : stats?.[filter.key as keyof QueueStats];
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
                {filter.label} {count !== undefined ? count : ''}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2 p-4 pt-0">
        {loading ? (
          <>
            <div className="h-[70px] animate-pulse rounded-lg bg-gray-100" />
            <div className="h-[70px] animate-pulse rounded-lg bg-gray-100" />
          </>
        ) : items.length === 0 ? (
          <div className="rounded-lg border border-gray-200 bg-white p-4 text-center text-sm text-gray-500">
            Nothing here.
          </div>
        ) : (
          items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => navigate(`/admin/refunds/${item.id}`)}
              className="flex w-full flex-col gap-1.5 rounded-lg border border-gray-200 bg-white p-3 text-left"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-mono text-xs font-bold text-gray-900">#{item.order_number}</div>
                  <div className="mt-0.5 text-sm font-medium text-gray-900">{item.customer_name}</div>
                </div>
                {item.refund_amount != null && (
                  <div className="whitespace-nowrap font-mono text-sm font-bold tabular-nums text-gray-900">
                    ₦{item.refund_amount.toLocaleString()}
                  </div>
                )}
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs text-gray-500">{item.reason_code?.replace(/_/g, ' ')}</span>
                <span className="shrink-0 font-mono text-[10.5px] text-gray-400">{relativeTime(item.created_at)}</span>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
    </PullToRefresh>
  );
}
