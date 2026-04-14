/**
 * Admin / staff: all storefront product reviews — filter, approve, reject.
 */
import { useState, useEffect, useCallback } from 'react';
import { Loader2, Star, RefreshCw } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const apiBase = import.meta.env.VITE_API_BASE_URL || '';

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

interface Meta {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
}

function ProductReviewsPage() {
  const { session } = useAuth();
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [meta, setMeta] = useState<Meta>({ page: 1, per_page: 30, total: 0, total_pages: 1 });
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const authHeader = session?.access_token ? `Bearer ${session.access_token}` : '';
  const perPage = 30;

  const load = useCallback(async () => {
    if (!authHeader) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        per_page: String(perPage),
      });
      if (statusFilter !== 'all') params.set('status', statusFilter);

      const res = await fetch(
        `${apiBase}/.netlify/functions/admin-product-reviews?${params}`,
        { headers: { Authorization: authHeader } }
      );
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Failed to load');
      setRows(json.data || []);
      if (json.meta) setMeta(json.meta);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load reviews');
    } finally {
      setLoading(false);
    }
  }, [authHeader, page, perPage, statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const setStatus = async (id: string, status: 'approved' | 'rejected' | 'pending') => {
    if (!authHeader) return;
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/.netlify/functions/admin-product-reviews`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        body: JSON.stringify({ id, status }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Update failed');
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Product reviews</h1>
          <p className="text-sm text-gray-600 mt-1">
            Approve or reject customer reviews. Approved reviews appear on the storefront.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as typeof statusFilter);
              setPage(1);
            }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          >
            <option value="all">All statuses</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
          <button
            type="button"
            onClick={() => load()}
            className="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 text-red-700 px-4 py-3 text-sm">{error}</div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20 text-gray-600">
          <Loader2 className="w-8 h-8 animate-spin mr-2" />
          Loading…
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-16 text-gray-500 border border-dashed border-gray-200 rounded-lg">
          No reviews in this filter.
        </div>
      ) : (
        <div className="space-y-4">
          {rows.map((r) => (
            <div
              key={r.id}
              className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
                <div>
                  <p className="font-semibold text-gray-900">{r.reviewer_name}</p>
                  <p className="text-xs text-gray-500">{r.reviewer_email}</p>
                  <p className="text-xs text-gray-400 mt-1">
                    {new Date(r.created_at).toLocaleString()} · Product:{' '}
                    <span className="text-gray-600">{r.products?.name ?? r.product_id}</span>
                    {r.vendors?.store_name && (
                      <> · Vendor: {r.vendors.store_name}</>
                    )}
                    {r.woo_product_id != null && <> · WC #{r.woo_product_id}</>}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-0.5">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star
                        key={i}
                        className={`w-4 h-4 ${i < r.rating ? 'fill-amber-400 text-amber-400' : 'text-gray-200'}`}
                      />
                    ))}
                  </div>
                  <span
                    className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      r.status === 'approved'
                        ? 'bg-green-100 text-green-800'
                        : r.status === 'rejected'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {r.status}
                  </span>
                </div>
              </div>
              <p className="text-sm text-gray-700 whitespace-pre-wrap mb-4">{r.body}</p>
              <div className="flex flex-wrap gap-2">
                {r.status !== 'approved' && (
                  <button
                    type="button"
                    disabled={busyId === r.id}
                    onClick={() => setStatus(r.id, 'approved')}
                    className="px-3 py-1.5 text-sm font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    Approve
                  </button>
                )}
                {r.status !== 'rejected' && (
                  <button
                    type="button"
                    disabled={busyId === r.id}
                    onClick={() => setStatus(r.id, 'rejected')}
                    className="px-3 py-1.5 text-sm font-medium rounded-lg border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    Reject
                  </button>
                )}
                {r.status !== 'pending' && (
                  <button
                    type="button"
                    disabled={busyId === r.id}
                    onClick={() => setStatus(r.id, 'pending')}
                    className="px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Mark pending
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {meta.total_pages > 1 && (
        <div className="flex justify-center gap-2 pt-2">
          <button
            type="button"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="px-3 py-1 border rounded-lg text-sm disabled:opacity-50"
          >
            Previous
          </button>
          <span className="text-sm text-gray-600 py-1">
            Page {page} / {meta.total_pages} ({meta.total} total)
          </span>
          <button
            type="button"
            disabled={page >= meta.total_pages || loading}
            onClick={() => setPage((p) => p + 1)}
            className="px-3 py-1 border rounded-lg text-sm disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

export default ProductReviewsPage;
