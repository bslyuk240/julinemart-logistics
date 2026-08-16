import { useCallback, useEffect, useState } from 'react';
import { ChevronRight, Loader, Star } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { PullToRefresh } from '../PullToRefresh';
import { Sheet } from '../Sheet';
import { TABBAR_SPACE, functionsBase } from '../lib/functionsAuth';

type StatusFilter = 'all' | 'pending' | 'approved' | 'rejected';

type ReviewRow = {
  id: string;
  created_at: string;
  gift_box_id: string;
  reviewer_name: string;
  reviewer_email: string;
  rating: number;
  body: string;
  status: string;
  gift_boxes?: { name: string; slug: string } | null;
};

const STATUS_TABS: { id: StatusFilter; label: string }[] = [
  { id: 'pending', label: 'Pending' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'all', label: 'All' },
];

const STATUS_BADGE: Record<string, string> = {
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-700',
  pending: 'bg-amber-100 text-amber-800',
};

export default function MobileGiftBoxReviews() {
  const { session } = useAuth();
  const notification = useNotification();
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReviewRow | null>(null);

  const authHeader = session?.access_token ? `Bearer ${session.access_token}` : '';

  const load = useCallback(async () => {
    if (!authHeader) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: '1', per_page: '50' });
      if (statusFilter !== 'all') params.set('status', statusFilter);
      const res = await fetch(`${functionsBase}/admin-gift-box-reviews?${params}`, {
        headers: { Authorization: authHeader },
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Failed to load');
      setRows(json.data || []);
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Failed to load reviews');
    } finally {
      setLoading(false);
    }
  }, [authHeader, notification, statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const setStatus = async (id: string, status: 'approved' | 'rejected' | 'pending') => {
    if (!authHeader) return;
    setBusyId(id);
    try {
      const res = await fetch(`${functionsBase}/admin-gift-box-reviews`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        body: JSON.stringify({ id, status }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Update failed');
      setSelected(null);
      await load();
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <PullToRefresh onRefresh={load}>
        <div style={{ paddingBottom: TABBAR_SPACE }}>
          <div className="sticky top-0 z-10 bg-gray-50 px-4 pb-3 pt-3">
            <div className="mb-3 flex items-center gap-2">
              <Star className="h-5 w-5 text-primary-600" />
              <h1 className="text-lg font-bold text-gray-900">Gift Box Reviews</h1>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {STATUS_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setStatusFilter(tab.id)}
                  className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${
                    statusFilter === tab.id ? 'bg-primary-600 text-white' : 'bg-white text-gray-600 ring-1 ring-gray-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2 px-4 pt-1">
            {loading ? (
              <div className="flex justify-center py-16">
                <Loader className="h-7 w-7 animate-spin text-primary-600" />
              </div>
            ) : rows.length === 0 ? (
              <div className="rounded-2xl bg-white px-6 py-12 text-center ring-1 ring-gray-100">
                <Star className="mx-auto mb-3 h-10 w-10 text-gray-300" />
                <p className="font-semibold text-gray-900">No reviews in this filter</p>
              </div>
            ) : (
              rows.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setSelected(r)}
                  className="flex w-full items-start gap-3 rounded-2xl bg-white p-3.5 text-left ring-1 ring-gray-100 active:bg-gray-50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="truncate font-semibold text-gray-900">{r.reviewer_name}</p>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_BADGE[r.status] || ''}`}>
                        {r.status}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-0.5">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Star
                          key={i}
                          className={`h-3.5 w-3.5 ${i < r.rating ? 'fill-amber-400 text-amber-400' : 'text-gray-200'}`}
                        />
                      ))}
                    </div>
                    <p className="mt-1 truncate text-xs text-gray-500">
                      {r.gift_boxes?.name ?? r.gift_box_id}
                    </p>
                    <p className="mt-1 line-clamp-2 text-xs text-gray-600">{r.body}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-gray-300" />
                </button>
              ))
            )}
          </div>
        </div>
      </PullToRefresh>

      <Sheet open={!!selected} onClose={() => setSelected(null)} ariaLabel="Review details">
        {selected && (
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-lg font-bold text-gray-900">{selected.reviewer_name}</h2>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[selected.status] || ''}`}>
                  {selected.status}
                </span>
              </div>
              <p className="text-xs text-gray-500">{selected.reviewer_email}</p>
              <p className="text-xs text-gray-400">
                {new Date(selected.created_at).toLocaleString()} · {selected.gift_boxes?.name ?? selected.gift_box_id}
              </p>
            </div>

            <div className="flex items-center gap-0.5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star
                  key={i}
                  className={`h-4 w-4 ${i < selected.rating ? 'fill-amber-400 text-amber-400' : 'text-gray-200'}`}
                />
              ))}
            </div>

            <p className="whitespace-pre-wrap rounded-2xl bg-gray-50 p-3.5 text-sm text-gray-700 ring-1 ring-gray-100">
              {selected.body}
            </p>

            <div className="flex flex-wrap gap-2">
              {selected.status !== 'approved' && (
                <button
                  type="button"
                  disabled={busyId === selected.id}
                  onClick={() => setStatus(selected.id, 'approved')}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl bg-green-600 py-3 text-sm font-semibold text-white disabled:opacity-50"
                >
                  Approve
                </button>
              )}
              {selected.status !== 'rejected' && (
                <button
                  type="button"
                  disabled={busyId === selected.id}
                  onClick={() => setStatus(selected.id, 'rejected')}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl border border-red-200 py-3 text-sm font-semibold text-red-700 disabled:opacity-50"
                >
                  Reject
                </button>
              )}
              {selected.status !== 'pending' && (
                <button
                  type="button"
                  disabled={busyId === selected.id}
                  onClick={() => setStatus(selected.id, 'pending')}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl border border-gray-200 py-3 text-sm font-semibold text-gray-700 disabled:opacity-50"
                >
                  Mark pending
                </button>
              )}
            </div>
          </div>
        )}
      </Sheet>
    </>
  );
}
