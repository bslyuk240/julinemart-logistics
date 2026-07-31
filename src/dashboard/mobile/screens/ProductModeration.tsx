import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, ImageOff, Loader, Plus, Search } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { clearProductListSessionCache } from '../../lib/productListSessionCache';
import { Sheet } from '../Sheet';
import { PullToRefresh } from '../PullToRefresh';
import { TABBAR_SPACE } from '../lib/functionsAuth';
import { formatProductListPrice } from '../lib/displayUtils';

const functionsBase = import.meta.env.VITE_NETLIFY_FUNCTIONS_BASE || '/.netlify/functions';

interface VendorOption {
  id: string;
  store_name: string;
}

interface ListProduct {
  id: string;
  name: string;
  type?: string;
  status: string;
  regular_price: number | null;
  sale_price: number | null;
  price?: number | null;
  min_price?: number | null;
  max_price?: number | null;
  sku: string | null;
  vendor: { store_name: string } | null;
  images: { src: string; alt: string; is_thumbnail: boolean }[];
}

interface ListMeta {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
}

type StatusFilter = 'all' | 'draft' | 'published';

const STATUS_FILTERS: Array<{ key: StatusFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'published', label: 'Live' },
];

export default function MobileProductModeration() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const notification = useNotification();
  const [products, setProducts] = useState<ListProduct[]>([]);
  const [meta, setMeta] = useState<ListMeta>({ page: 1, per_page: 20, total: 0, total_pages: 0 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [selected, setSelected] = useState<ListProduct | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [vendorSheetOpen, setVendorSheetOpen] = useState(false);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const authHeader = session?.access_token ? `Bearer ${session.access_token}` : '';

  useEffect(() => {
    if (!authHeader) return;
    fetch(`${functionsBase}/catalog-meta?type=vendors`, { headers: { Authorization: authHeader } })
      .then((r) => r.json())
      .then((json) => setVendors(json.data || []))
      .catch(() => {});
  }, [authHeader]);

  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [searchInput]);

  const loadProducts = useCallback(async () => {
    if (!authHeader) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        per_page: '20',
        status: statusFilter,
      });
      if (search) params.set('search', search);
      if (vendorId) params.set('vendor_id', vendorId);

      const res = await fetch(`${functionsBase}/catalog-products?${params}`, {
        headers: { Authorization: authHeader },
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Failed to load products');
      setProducts(json.data || []);
      setMeta(json.meta || { page, per_page: 20, total: 0, total_pages: 0 });
    } catch (err) {
      notification.error('Load failed', err instanceof Error ? err.message : 'Failed to load products');
    } finally {
      setLoading(false);
    }
  }, [authHeader, page, statusFilter, search, vendorId, notification]);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  const toggleStatus = async (product: ListProduct) => {
    const newStatus = product.status === 'published' ? 'draft' : 'published';
    setActionLoading(product.id);
    try {
      const res = await fetch(`${functionsBase}/catalog-product-upsert?id=${product.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        body: JSON.stringify({ status: newStatus }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Update failed');
      clearProductListSessionCache();
      notification.success(newStatus === 'published' ? 'Published' : 'Moved to draft');
      setSelected(null);
      loadProducts();
    } catch (err) {
      notification.error('Update failed', err instanceof Error ? err.message : 'Failed to update');
    } finally {
      setActionLoading(null);
    }
  };

  const deleteProduct = async (product: ListProduct) => {
    setActionLoading(product.id);
    try {
      const res = await fetch(`${functionsBase}/catalog-product-upsert?id=${product.id}`, {
        method: 'DELETE',
        headers: { Authorization: authHeader },
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Delete failed');
      clearProductListSessionCache();
      notification.success('Deleted', 'Product removed');
      setSelected(null);
      setConfirmDelete(false);
      loadProducts();
    } catch (err) {
      notification.error('Delete failed', err instanceof Error ? err.message : 'Failed to delete');
    } finally {
      setActionLoading(null);
    }
  };

  const vendorLabel = vendorId ? vendors.find((v) => v.id === vendorId)?.store_name || 'Vendor' : 'All vendors';

  return (
    <>
      <PullToRefresh onRefresh={loadProducts}>
        <div style={{ paddingBottom: TABBAR_SPACE }}>
          <div className="sticky top-0 z-10 space-y-2.5 bg-gray-50 px-4 pb-3 pt-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h1 className="text-lg font-bold text-gray-900">Products</h1>
                <p className="text-xs text-gray-500">{meta.total > 0 ? `${meta.total} total` : 'Catalog list'}</p>
              </div>
              <button
                type="button"
                onClick={() => navigate('/admin/products/upload')}
                className="flex items-center gap-1 rounded-lg bg-primary-600 px-3 py-2 text-xs font-semibold text-white"
              >
                <Plus className="h-3.5 w-3.5" />
                Add
              </button>
            </div>

            <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-2.5 ring-1 ring-gray-100">
              <Search className="h-4 w-4 shrink-0 text-gray-400" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search name or SKU"
                className="w-full bg-transparent text-sm text-gray-900 outline-none placeholder:text-gray-400"
                style={{ fontSize: '16px' }}
              />
            </div>

            <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4">
              {STATUS_FILTERS.map((filter) => (
                <button
                  key={filter.key}
                  type="button"
                  onClick={() => {
                    setStatusFilter(filter.key);
                    setPage(1);
                  }}
                  className={`whitespace-nowrap rounded-full px-3 py-2 text-[11px] font-semibold ${
                    statusFilter === filter.key ? 'bg-primary-600 text-white' : 'bg-white text-gray-600 ring-1 ring-gray-200'
                  }`}
                >
                  {filter.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setVendorSheetOpen(true)}
              className="w-full rounded-xl bg-white px-3 py-2.5 text-left ring-1 ring-gray-100"
            >
              <span className="text-[10px] font-medium uppercase tracking-wide text-gray-400">Vendor</span>
              <p className="truncate font-medium text-sm text-gray-900">{vendorLabel}</p>
            </button>
          </div>

          <div className="space-y-2 px-4 pt-1">
            {loading ? (
              <div className="flex justify-center py-16">
                <Loader className="h-6 w-6 animate-spin text-primary-600" />
              </div>
            ) : products.length === 0 ? (
              <div className="rounded-xl bg-white p-6 text-center text-sm text-gray-500 ring-1 ring-gray-100">No products match.</div>
            ) : (
              products.map((product) => {
                const thumb = product.images?.find((i) => i.is_thumbnail) || product.images?.[0];
                return (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => setSelected(product)}
                    className="flex w-full items-center gap-3 rounded-xl bg-white p-3 text-left ring-1 ring-gray-100"
                  >
                    {thumb ? (
                      <img src={thumb.src} alt={thumb.alt || product.name} className="h-12 w-12 shrink-0 rounded-lg object-cover" />
                    ) : (
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-gray-50 text-gray-300">
                        <ImageOff className="h-5 w-5" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-gray-900">{product.name}</p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                            product.status === 'published' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {product.status === 'published' ? 'live' : product.status}
                        </span>
                        {product.type === 'variable' && (
                          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">variable</span>
                        )}
                        {product.vendor && <span className="truncate text-xs text-gray-500">{product.vendor.store_name}</span>}
                      </div>
                    </div>
                    <p className="shrink-0 text-right text-sm font-semibold tabular-nums text-gray-900">
                      {formatProductListPrice(product)}
                    </p>
                  </button>
                );
              })
            )}

            {meta.total_pages > 1 && (
              <div className="flex items-center justify-center gap-3 py-3">
                <button
                  type="button"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium disabled:opacity-50"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Prev
                </button>
                <span className="text-xs text-gray-500">
                  Page {page} of {meta.total_pages}
                </span>
                <button
                  type="button"
                  disabled={page >= meta.total_pages || loading}
                  onClick={() => setPage((p) => p + 1)}
                  className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium disabled:opacity-50"
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      </PullToRefresh>

      <Sheet open={vendorSheetOpen} onClose={() => setVendorSheetOpen(false)} ariaLabel="Filter by vendor">
        <h3 className="text-base font-bold text-gray-900">Vendor</h3>
        <div className="max-h-72 space-y-1 overflow-y-auto">
          <button
            type="button"
            onClick={() => {
              setVendorId('');
              setPage(1);
              setVendorSheetOpen(false);
            }}
            className={`w-full rounded-lg px-3 py-2.5 text-left text-sm ${!vendorId ? 'bg-primary-50 font-semibold text-primary-700' : 'text-gray-700'}`}
          >
            All vendors
          </button>
          {vendors.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => {
                setVendorId(v.id);
                setPage(1);
                setVendorSheetOpen(false);
              }}
              className={`w-full rounded-lg px-3 py-2.5 text-left text-sm ${vendorId === v.id ? 'bg-primary-50 font-semibold text-primary-700' : 'text-gray-700'}`}
            >
              {v.store_name}
            </button>
          ))}
        </div>
      </Sheet>

      <Sheet open={!!selected} onClose={() => { setSelected(null); setConfirmDelete(false); }} ariaLabel="Product actions">
        {selected && (
          <>
            <div className="flex items-center gap-3">
              {(() => {
                const thumb = selected.images?.find((i) => i.is_thumbnail) || selected.images?.[0];
                return thumb ? (
                  <img src={thumb.src} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" />
                ) : (
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-gray-50 text-gray-300">
                    <ImageOff className="h-6 w-6" />
                  </div>
                );
              })()}
              <div className="min-w-0">
                <p className="font-bold text-gray-900">{selected.name}</p>
                {selected.vendor && <p className="text-sm text-gray-500">{selected.vendor.store_name}</p>}
              </div>
            </div>

            {confirmDelete ? (
              <div className="space-y-2">
                <p className="text-center text-sm text-gray-600">Delete permanently?</p>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setConfirmDelete(false)} className="rounded-xl border border-gray-200 py-3 text-sm font-semibold">
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteProduct(selected)}
                    disabled={actionLoading === selected.id}
                    className="rounded-xl bg-red-600 py-3 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    {actionLoading === selected.id ? 'Deleting…' : 'Delete'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => navigate(`/admin/products/upload?id=${selected.id}`)}
                  className="w-full rounded-xl bg-gray-900 py-3 text-sm font-semibold text-white"
                >
                  Edit product
                </button>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setConfirmDelete(true)} className="rounded-xl border border-red-200 py-3 text-sm font-semibold text-red-700">
                    Delete
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleStatus(selected)}
                    disabled={actionLoading === selected.id}
                    className={`rounded-xl py-3 text-sm font-semibold disabled:opacity-60 ${
                      selected.status === 'published' ? 'border border-gray-200 text-gray-900' : 'bg-primary-600 text-white'
                    }`}
                  >
                    {actionLoading === selected.id ? 'Saving…' : selected.status === 'published' ? 'Unpublish' : 'Publish'}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </Sheet>
    </>
  );
}
