import { useEffect, useState } from 'react';
import { Package, Search, AlertCircle } from 'lucide-react';
import { api } from '../lib/api';

const fmt = (n: number) => `₦${Number(n || 0).toLocaleString()}`;

const STATUS_BADGE: Record<string, string> = {
  publish:   'bg-green-100 text-green-700',
  published: 'bg-green-100 text-green-700',
  draft:     'bg-yellow-100 text-yellow-700',
  trash:     'bg-red-100 text-red-700',
};

const STATUS_LABEL: Record<string, string> = {
  publish:   'Live',
  published: 'Live',
  draft:     'Draft',
  trash:     'Trash',
};

export default function Products() {
  const [data, setData]       = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [search, setSearch]   = useState('');
  const [status, setStatus]   = useState('');
  const [page, setPage]       = useState(1);

  useEffect(() => {
    setLoading(true);
    api.getProducts({ page: String(page), ...(search && { search }), ...(status && { status }) })
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [page, search, status]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">My Products</h1>
        {data?.total != null && (
          <span className="text-sm text-gray-500">{data.total} total</span>
        )}
      </div>

      {/* Search + filter */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            className="input pl-9"
            placeholder="Search products…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <select
          className="input w-28 flex-shrink-0"
          value={status}
          onChange={e => { setStatus(e.target.value); setPage(1); }}
        >
          <option value="">All</option>
          <option value="publish">Live</option>
          <option value="draft">Draft</option>
        </select>
      </div>

      {error && (
        <div className="card flex items-center gap-3 text-red-600">
          <AlertCircle className="w-5 h-5 flex-shrink-0" /> {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* 2-col grid on mobile, 3-col on md, 4-col on xl */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
            {(data?.products || []).map((p: any) => (
              <div key={p.id} className="card p-0 overflow-hidden hover:shadow-md active:scale-[0.98] transition-all">
                {p.image
                  ? <img src={p.image} alt={p.name} className="w-full h-32 object-cover" />
                  : <div className="w-full h-32 bg-gray-100 flex items-center justify-center"><Package className="w-10 h-10 text-gray-300" /></div>
                }
                <div className="p-3">
                  <div className="flex items-start justify-between gap-1 mb-1.5">
                    <p className="font-semibold text-xs text-gray-900 line-clamp-2 flex-1 leading-snug">{p.name}</p>
                    <span className={`badge text-[10px] flex-shrink-0 ${STATUS_BADGE[p.status] || 'bg-gray-100 text-gray-600'}`}>
                      {STATUS_LABEL[p.status] || p.status}
                    </span>
                  </div>
                  {p.sku && <p className="text-[10px] text-gray-400 mb-1.5 truncate">SKU: {p.sku}</p>}
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-bold text-primary-600 text-sm">{fmt(p.price)}</span>
                    <span className={`text-[10px] font-medium ${p.stock_status === 'instock' ? 'text-green-600' : 'text-red-500'}`}>
                      {p.stock_status === 'instock'
                        ? p.stock_qty != null ? `${p.stock_qty} left` : 'In stock'
                        : 'Out of stock'}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {!data?.products?.length && (
            <div className="card text-center py-16 text-gray-400">
              <Package className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No products found</p>
              <p className="text-sm mt-1">Your published products appear here</p>
            </div>
          )}

          {/* Pagination */}
          {data?.total_pages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <p className="text-sm text-gray-500">Page {page} of {data.total_pages}</p>
              <div className="flex gap-2">
                <button className="btn-secondary btn-sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
                <button className="btn-secondary btn-sm" disabled={page >= data.total_pages} onClick={() => setPage(p => p + 1)}>Next →</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
