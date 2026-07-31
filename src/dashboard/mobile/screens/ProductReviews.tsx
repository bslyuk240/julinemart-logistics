import { useCallback, useEffect, useState } from 'react';
import { Loader, Star } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { PullToRefresh } from '../PullToRefresh';
import { TABBAR_SPACE, functionsBase } from '../lib/functionsAuth';
import { statusStyle } from '../lib/displayUtils';

interface ReviewRow {
  id: string;
  created_at: string;
  product_id: string;
  woo_product_id: number | null;
  reviewer_name: string;
  reviewer_email: string;
  rating: number;
  body: string;
  status: string;
  products?: { name: string; slug: string } | null;
  vendors?: { store_name: string; store_slug: string } | null;
}

const STATUS_FILTERS = ['pending', 'approved', 'rejected', 'all'] as const;

function Stars({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star key={i} className={`h-3.5 w-3.5 ${i < rating ? 'fill-amber-400 text-amber-400' : 'text-gray-200'}`} />
      ))}
    </div>
  );
}

export default function MobileProductReviews() {
  const { session } = useAuth();
  const notification = useNotification();
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>('pending');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session?.access_token) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), per_page: '20' });
      if (statusFilter !== 'all') params.set('status', statusFilter);
      const res = await fetch(`${functionsBase}/admin-product-reviews?${params}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Failed to load');
      setRows(json.data || []);
      setTotalPages(json.meta?.total_pages ?? 1);
    } catch (err) {
      notification.error('Load failed', err instanceof Error ? err.message : 'Unable to load reviews');
    } finally {
      setLoading(false);
    }
  }, [notification, page, session?.access_token, statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const setStatus = async (id: string, status: 'approved' | 'rejected' | 'pending') => {
    if (!session?.access_token) return;
    setBusyId(id);
    try {
      const res = await fetch(`${functionsBase}/admin-product-reviews`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ id, status }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Update failed');
      notification.success('Updated', `Review marked ${status}`);
      await load();
    } catch (err) {
      notification.error('Update failed', err instanceof Error ? err.message : 'Unable to update review');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <PullToRefresh onRefresh={load}>
      <div className="space-y-3 p-4" style={{ paddingBottom: TABBAR_SPACE }}>
        <div>
          <h1 className="text-lg font-bold text-gray-900">Product Reviews</h1>
          <p className="text-xs text-gray-500">Approve or reject storefront reviews</p>
        </div>

        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4">
          {STATUS_FILTERS.map((key) => {
            const active = statusFilter === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setStatusFilter(key);
                  setPage(1);
                }}
                className={`whitespace-nowrap rounded-full border px-3 py-2 text-[11px] font-medium capitalize ${
                  active ? 'border-primary-600 bg-primary-600 text-white' : 'border-gray-200 bg-white text-gray-600'
                }`}
              >
                {key}
              </button>
            );
          })}
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader className="h-6 w-6 animate-spin text-primary-600" />
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-xl bg-white p-4 text-center text-sm text-gray-500 ring-1 ring-gray-100">No reviews in this filter.</div>
        ) : (
          <div className="space-y-2">
            {rows.map((r) => (
              <div key={r.id} className="rounded-xl bg-white p-3.5 ring-1 ring-gray-100">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900">{r.reviewer_name}</p>
                    <p className="truncate text-xs text-gray-500">{r.reviewer_email}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${statusStyle(r.status)}`}>
                    {r.status}
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <Stars rating={r.rating} />
                  <span className="text-[11px] text-gray-400">{new Date(r.created_at).toLocaleDateString()}</span>
                </div>
                <p className="mt-1 text-xs font-medium text-gray-700">{r.products?.name ?? r.product_id}</p>
                {r.vendors?.store_name && <p className="text-[11px] text-gray-400">{r.vendors.store_name}</p>}
                <p className="mt-2 text-sm leading-relaxed text-gray-700">{r.body}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {r.status !== 'approved' && (
                    <button
                      type="button"
                      disabled={busyId === r.id}
                      onClick={() => setStatus(r.id, 'approved')}
                      className="rounded-lg bg-green-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      Approve
                    </button>
                  )}
                  {r.status !== 'rejected' && (
                    <button
                      type="button"
                      disabled={busyId === r.id}
                      onClick={() => setStatus(r.id, 'rejected')}
                      className="rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 disabled:opacity-50"
                    >
                      Reject
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-3 pt-2">
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm disabled:opacity-50"
            >
              Previous
            </button>
            <span className="text-xs text-gray-500">
              {page} / {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm disabled:opacity-50"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </PullToRefresh>
  );
}
