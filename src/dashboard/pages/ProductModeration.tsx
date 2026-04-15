/**
 * Products — general product list (Supabase-backed)
 *
 * Lists all products regardless of source (CJ import, manual upload, migrated).
 * Supports: status filter, search, vendor filter, quick publish/unpublish, edit, delete.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Edit2,
  Globe,
  ImageOff,
  Loader2,
  Package,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { clearProductListSessionCache } from '../lib/productListSessionCache';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Vendor {
  id: string;
  store_name: string;
  woocommerce_vendor_id: string;
}

interface ListProduct {
  id: string;
  name: string;
  slug: string;
  status: string;
  type: string;
  regular_price: number | null;
  sale_price: number | null;
  sku: string | null;
  sourcing_meta: Record<string, unknown> | null;
  created_at: string;
  vendor: Vendor | null;
  hub: { id: string; name: string; code: string } | null;
  images: { src: string; alt: string; is_thumbnail: boolean }[];
  categories: { id: string; name: string }[];
}

type StatusFilter = 'all' | 'draft' | 'published';

const apiBase = import.meta.env.VITE_API_BASE_URL || '';
const CACHE_TTL_MS = 5 * 60 * 1000;

function cacheKey(page: number, status: string, search: string, vendorId: string) {
  return `jlo_products_${status}_${vendorId}_${search}_p${page}`;
}

function readCache(key: string): { data: ListProduct[]; meta: Meta } | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const { data, meta, ts } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL_MS) { sessionStorage.removeItem(key); return null; }
    return { data, meta };
  } catch { return null; }
}

function writeCache(key: string, data: ListProduct[], meta: Meta) {
  try { sessionStorage.setItem(key, JSON.stringify({ data, meta, ts: Date.now() })); } catch { /* ignore */ }
}

interface Meta {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
}

function parseListPage(sp: URLSearchParams): number {
  const n = parseInt(sp.get('page') || '1', 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

function parseListStatus(sp: URLSearchParams): StatusFilter {
  const s = sp.get('status');
  if (s === 'draft' || s === 'published') return s;
  return 'all';
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ProductModerationPage() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  const page = parseListPage(searchParams);
  const statusFilter = parseListStatus(searchParams);
  const vendorId = searchParams.get('vendor') || '';
  const search = searchParams.get('q') || '';

  const [products, setProducts] = useState<ListProduct[]>([]);
  const [meta, setMeta] = useState<Meta>({ page: 1, per_page: 20, total: 0, total_pages: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState(() => searchParams.get('q') || '');
  const [vendors, setVendors] = useState<Vendor[]>([]);

  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchParamsRef = useRef(searchParams);
  searchParamsRef.current = searchParams;

  const mergeSearchParams = useCallback(
    (patch: Record<string, string | undefined>, navOpts?: { replace?: boolean }) => {
      const next = new URLSearchParams(searchParamsRef.current);
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === '') next.delete(k);
        else next.set(k, v);
      }
      setSearchParams(next, navOpts);
    },
    [setSearchParams]
  );

  const qInUrl = searchParams.get('q') || '';
  useEffect(() => {
    setSearchInput(qInUrl);
  }, [qInUrl]);

  const authHeader = useCallback(() =>
    session?.access_token ? `Bearer ${session.access_token}` : '',
  [session]);

  // Load vendors for filter dropdown
  useEffect(() => {
    fetch(`${apiBase}/.netlify/functions/catalog-meta?type=vendors`, {
      headers: { Authorization: authHeader() },
    })
      .then((r) => r.json())
      .then((j) => { if (j.success) setVendors(j.data || []); })
      .catch(() => {/* non-critical */});
  }, [authHeader]);

  // Load products
  const loadProducts = useCallback(async (p: number, force = false) => {
    const key = cacheKey(p, statusFilter, search, vendorId);
    if (!force) {
      const cached = readCache(key);
      if (cached) { setProducts(cached.data); setMeta(cached.meta); return; }
    }

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        page: String(p),
        per_page: '20',
        status: statusFilter,
      });
      if (search) params.set('search', search);
      if (vendorId) params.set('vendor_id', vendorId);

      const res = await fetch(
        `${apiBase}/.netlify/functions/catalog-products?${params.toString()}`,
        { headers: { Authorization: authHeader() } }
      );
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Failed to load products');

      setProducts(json.data || []);
      setMeta(json.meta || { page: p, per_page: 20, total: 0, total_pages: 0 });
      writeCache(key, json.data || [], json.meta);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load products');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, search, vendorId, authHeader]);

  useEffect(() => {
    loadProducts(page);
  }, [page, statusFilter, search, vendorId, loadProducts]);

  useEffect(() => {
    if (loading || meta.total_pages <= 0) return;
    if (page > meta.total_pages) {
      mergeSearchParams({ page: String(meta.total_pages) }, { replace: true });
    }
  }, [loading, meta.total_pages, page, mergeSearchParams]);

  // Debounced search → URL (replace so back from product still lands on list page, not each keystroke)
  const handleSearchChange = (val: string) => {
    setSearchInput(val);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      const next = new URLSearchParams(searchParamsRef.current);
      const trimmed = val.trim();
      if (trimmed) next.set('q', trimmed);
      else next.delete('q');
      next.set('page', '1');
      setSearchParams(next, { replace: true });
    }, 400);
  };

  // Quick status toggle (publish / revert to draft)
  const toggleStatus = async (product: ListProduct) => {
    const newStatus = product.status === 'published' ? 'draft' : 'published';
    setActionLoading(product.id);
    try {
      const res = await fetch(
        `${apiBase}/.netlify/functions/catalog-product-upsert?id=${product.id}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: authHeader() },
          body: JSON.stringify({ status: newStatus }),
        }
      );
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Update failed');
      clearProductListSessionCache();
      loadProducts(page, true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update status');
    } finally {
      setActionLoading(null);
    }
  };

  // Delete product
  const deleteProduct = async (id: string) => {
    setActionLoading(id);
    setDeleteConfirm(null);
    try {
      const res = await fetch(
        `${apiBase}/.netlify/functions/catalog-product-upsert?id=${id}`,
        { method: 'DELETE', headers: { Authorization: authHeader() } }
      );
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Delete failed');
      clearProductListSessionCache();
      loadProducts(page, true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to delete product');
    } finally {
      setActionLoading(null);
    }
  };

  // ─── Helpers ────────────────────────────────────────────────────────────────

  const isCjImport = (p: ListProduct) =>
    !!(p.sourcing_meta && (p.sourcing_meta as Record<string, unknown>).cj_product_id);

  const formatPrice = (price: number | null) =>
    price != null ? `₦${price.toLocaleString()}` : '—';

  const thumbnail = (p: ListProduct) =>
    (p.images || []).find((i) => i.is_thumbnail)?.src || p.images?.[0]?.src || null;

  // ─── Render ─────────────────────────────────────────────────────────────────

  const statusTabs: { label: string; value: StatusFilter; count?: number }[] = [
    { label: 'All', value: 'all' },
    { label: 'Draft', value: 'draft' },
    { label: 'Published', value: 'published' },
  ];

  return (
    <div className="w-full max-w-none p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Products</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {meta.total > 0 ? `${meta.total} product${meta.total !== 1 ? 's' : ''}` : 'No products'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { clearProductListSessionCache(); loadProducts(page, true); }}
            className="p-2 text-gray-400 hover:text-gray-600 rounded-md hover:bg-gray-100"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() =>
              navigate('/admin/products/upload', {
                state: { returnTo: `${location.pathname}${location.search}` },
              })
            }
            className="flex items-center gap-1.5 bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700"
          >
            <Plus className="w-4 h-4" />
            Add Product
          </button>
        </div>
      </div>

      {/* Status tabs */}
      <div className="flex gap-1 border-b border-gray-200 mb-4">
        {statusTabs.map((tab) => (
          <button
            key={tab.value}
            onClick={() => {
              if (tab.value === 'all') {
                mergeSearchParams({ status: undefined, page: '1' });
              } else {
                mergeSearchParams({ status: tab.value, page: '1' });
              }
            }}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              statusFilter === tab.value
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <input
          type="text"
          placeholder="Search products..."
          value={searchInput}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="flex-1 border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <select
          value={vendorId}
          onChange={(e) =>
            mergeSearchParams({ vendor: e.target.value || undefined, page: '1' })
          }
          className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[180px]"
        >
          <option value="">All Vendors</option>
          {vendors.map((v) => (
            <option key={v.id} value={v.id}>{v.store_name}</option>
          ))}
        </select>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-md p-3 mb-4 text-sm text-red-700">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Product list */}
      {loading ? (
        <div className="flex items-center justify-center py-24 text-gray-400">
          <Loader2 className="w-6 h-6 animate-spin mr-2" />
          Loading products…
        </div>
      ) : products.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-gray-400">
          <Package className="w-10 h-10 mb-3" />
          <p className="text-sm">No products found</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
          {products.map((product) => {
            const thumb = thumbnail(product);
            const isCj = isCjImport(product);
            const isActing = actionLoading === product.id;

            return (
              <div key={product.id} className="flex items-center gap-4 px-4 py-3">
                {/* Thumbnail */}
                <div className="w-14 h-14 flex-shrink-0 rounded-md overflow-hidden bg-gray-100 border border-gray-200">
                  {thumb ? (
                    <img src={thumb} alt={product.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <ImageOff className="w-5 h-5 text-gray-300" />
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-gray-900 text-sm truncate max-w-xs">
                      {product.name}
                    </span>
                    {/* Status badge */}
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      product.status === 'published'
                        ? 'bg-green-100 text-green-700'
                        : 'bg-yellow-100 text-yellow-700'
                    }`}>
                      {product.status}
                    </span>
                    {/* Type badge */}
                    {product.type === 'variable' && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 font-medium">
                        variable
                      </span>
                    )}
                    {/* Source badge */}
                    {isCj && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-purple-50 text-purple-600 font-medium flex items-center gap-1">
                        <Globe className="w-3 h-3" />
                        CJ
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500">
                    {product.vendor && <span>{product.vendor.store_name}</span>}
                    {product.hub && <span>· {product.hub.name}</span>}
                    {product.categories.length > 0 && (
                      <span>· {product.categories.map((c) => c.name).join(', ')}</span>
                    )}
                  </div>
                </div>

                {/* Price */}
                <div className="text-right hidden sm:block w-24 flex-shrink-0">
                  <div className="text-sm font-medium text-gray-900">
                    {product.sale_price
                      ? formatPrice(product.sale_price)
                      : formatPrice(product.regular_price)}
                  </div>
                  {product.sale_price && product.regular_price && (
                    <div className="text-xs text-gray-400 line-through">
                      {formatPrice(product.regular_price)}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  {/* Publish / Unpublish */}
                  <button
                    onClick={() => toggleStatus(product)}
                    disabled={isActing}
                    title={product.status === 'published' ? 'Revert to draft' : 'Publish'}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors disabled:opacity-50 ${
                      product.status === 'published'
                        ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        : 'bg-green-600 text-white hover:bg-green-700'
                    }`}
                  >
                    {isActing ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : product.status === 'published' ? (
                      'Unpublish'
                    ) : (
                      'Publish'
                    )}
                  </button>

                  {/* Edit */}
                  <button
                    onClick={() =>
                      navigate(`/admin/products/upload?id=${product.id}`, {
                        state: { returnTo: `${location.pathname}${location.search}` },
                      })
                    }
                    className="p-1.5 text-gray-400 hover:text-blue-600 rounded-md hover:bg-blue-50"
                    title="Edit product"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>

                  {/* Delete */}
                  {deleteConfirm === product.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => deleteProduct(product.id)}
                        disabled={isActing}
                        className="px-2 py-1 text-xs bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50"
                      >
                        {isActing ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Confirm'}
                      </button>
                      <button
                        onClick={() => setDeleteConfirm(null)}
                        className="px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded-md hover:bg-gray-200"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setDeleteConfirm(product.id)}
                      className="p-1.5 text-gray-400 hover:text-red-600 rounded-md hover:bg-red-50"
                      title="Delete product"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {meta.total_pages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-gray-500">
            Page {meta.page} of {meta.total_pages} ({meta.total} total)
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => mergeSearchParams({ page: String(Math.max(page - 1, 1)) })}
              disabled={page <= 1 || loading}
              className="p-1.5 rounded-md border border-gray-300 text-gray-500 hover:bg-gray-50 disabled:opacity-40"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() =>
                mergeSearchParams({ page: String(Math.min(page + 1, meta.total_pages)) })
              }
              disabled={page >= meta.total_pages || loading}
              className="p-1.5 rounded-md border border-gray-300 text-gray-500 hover:bg-gray-50 disabled:opacity-40"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
