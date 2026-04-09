import { useEffect, useState } from 'react';
import { Package, Search, AlertCircle } from 'lucide-react';
import { api } from '../lib/api';

const fmt = (n: number) => `₦${Number(n || 0).toLocaleString()}`;

const STATUS_BADGE: Record<string, string> = {
  publish: 'bg-green-100 text-green-700',
  draft:   'bg-yellow-100 text-yellow-700',
  trash:   'bg-red-100 text-red-700',
};

export default function Products() {
  const [data, setData]       = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [search, setSearch]   = useState('');
  const [status, setStatus]   = useState('');
  const [page, setPage]       = useState(1);

  const load = (params: Record<string, string> = {}) => {
    setLoading(true);
    api.getProducts({ page: String(page), ...params })
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load({ page: String(page), ...(search && { search }), ...(status && { status }) }); }, [page, search, status]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">My Products</h1>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            className="input pl-9"
            placeholder="Search products..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <select className="input w-full sm:w-40" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All Status</option>
          <option value="publish">Published</option>
          <option value="draft">Draft</option>
        </select>
      </div>

      {error && <div className="card flex items-center gap-3 text-red-600"><AlertCircle className="w-5 h-5" />{error}</div>}

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {(data?.products || []).map((p: any) => (
              <div key={p.id} className="card p-0 overflow-hidden hover:shadow-md transition-shadow">
                {p.image
                  ? <img src={p.image} alt={p.name} className="w-full h-40 object-cover" />
                  : <div className="w-full h-40 bg-gray-100 flex items-center justify-center"><Package className="w-12 h-12 text-gray-300" /></div>
                }
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <p className="font-medium text-sm text-gray-900 line-clamp-2">{p.name}</p>
                    <span className={`badge flex-shrink-0 ${STATUS_BADGE[p.status] || 'bg-gray-100 text-gray-600'}`}>{p.status}</span>
                  </div>
                  {p.sku && <p className="text-xs text-gray-400 mb-2">SKU: {p.sku}</p>}
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-primary-600">{fmt(p.price)}</span>
                    <span className={`text-xs ${p.stock_status === 'instock' ? 'text-green-600' : 'text-red-500'}`}>
                      {p.stock_status === 'instock' ? 'In Stock' : 'Out of Stock'}
                      {p.stock_qty != null && ` (${p.stock_qty})`}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {!data?.products?.length && (
            <div className="card text-center py-12 text-gray-400">
              <Package className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>No products found</p>
            </div>
          )}

          {/* Pagination */}
          {data?.total_pages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-500">{data.total} products total</p>
              <div className="flex gap-2">
                <button className="btn-secondary text-sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</button>
                <span className="px-3 py-2 text-sm text-gray-600">Page {page} of {data.total_pages}</span>
                <button className="btn-secondary text-sm" disabled={page >= data.total_pages} onClick={() => setPage(p => p + 1)}>Next</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
