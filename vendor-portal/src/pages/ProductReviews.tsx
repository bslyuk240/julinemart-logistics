import { useEffect, useState, useCallback } from 'react';
import { Loader2, Star, RefreshCw } from 'lucide-react';
import { api } from '../lib/api';

interface ReviewRow {
  id: string;
  created_at: string;
  rating: number;
  body: string;
  status: string;
  reviewer_name: string;
  reviewer_email: string;
  woo_product_id: number | null;
  products?: { name: string; slug: string } | null;
}

export default function ProductReviews() {
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [meta, setMeta] = useState({ page: 1, per_page: 30, total: 0, total_pages: 1 });
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = {
        page: String(page),
        per_page: '30',
      };
      if (status !== 'all') params.status = status;
      const res = await api.getVendorProductReviews(params);
      setRows(res.data);
      setMeta(res.meta);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not load reviews');
    } finally {
      setLoading(false);
    }
  }, [page, status]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Product reviews</h1>
          <p className="text-sm text-gray-600 mt-1">
            Customer feedback on your products. Pending items await JulineMart approval before they appear on the store.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as typeof status);
              setPage(1);
            }}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
          >
            <option value="all">All</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
          <button
            type="button"
            onClick={() => load()}
            className="inline-flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-lg text-sm hover:bg-gray-50"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 text-red-700 px-4 py-3 text-sm">{error}</div>
      )}

      {loading ? (
        <div className="flex justify-center py-16 text-gray-600">
          <Loader2 className="w-8 h-8 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-16 text-gray-500 border border-dashed border-gray-200 rounded-xl bg-white">
          No reviews yet for your products.
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.id} className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                <div>
                  <p className="font-semibold text-gray-900">{r.reviewer_name}</p>
                  <p className="text-xs text-gray-500">{r.reviewer_email}</p>
                  <p className="text-xs text-gray-400 mt-1">
                    {new Date(r.created_at).toLocaleString()}
                    {r.products?.name && <> · {r.products.name}</>}
                    {r.woo_product_id != null && <> · #{r.woo_product_id}</>}
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
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{r.body}</p>
            </li>
          ))}
        </ul>
      )}

      {meta.total_pages > 1 && (
        <div className="flex justify-center items-center gap-3 pt-2">
          <button
            type="button"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="px-3 py-1.5 border rounded-lg text-sm disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-sm text-gray-600">
            Page {page} / {meta.total_pages}
          </span>
          <button
            type="button"
            disabled={page >= meta.total_pages || loading}
            onClick={() => setPage((p) => p + 1)}
            className="px-3 py-1.5 border rounded-lg text-sm disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
