import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../contexts/AuthContext';
import {
  AlertCircle,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  ImageOff,
  Loader2,
  Package,
  RefreshCw,
  Save,
  Tag,
  X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProductImage {
  id?: number;
  src: string;
  alt: string;
}

interface WcTerm {
  id: number;
  name: string;
  slug: string;
}

interface WcCategory extends WcTerm {
  parent: number;
}

interface WcAttribute {
  id: number;
  name: string;
  visible: boolean;
  variation: boolean;
  options: string[];
}

interface WcVariation {
  id: number;
  sku: string;
  regular_price: string;
  sale_price: string;
  stock_status: string;
  manage_stock: boolean;
  stock_quantity: number | null;
  image: ProductImage | null;
  attributes: { name: string; option: string }[];
}

interface Vendor {
  id: string;
  store_name: string;
  woocommerce_vendor_id: string;
}

interface Hub {
  id: string;
  name: string;
  code: string;
}

interface ProductDetail {
  id: number;
  name: string;
  type: string;
  status: string;
  description: string;
  short_description: string;
  sku: string;
  regular_price: string;
  sale_price: string;
  stock_status: string;
  manage_stock: boolean;
  stock_quantity: number | null;
  weight: string;
  dimensions: { length: string; width: string; height: string };
  shipping_class: string;
  catalog_visibility: string;
  images: ProductImage[];
  categories: WcTerm[];
  tags: WcTerm[];
  attributes: WcAttribute[];
  variations: WcVariation[];
  provider: string;
  cj_pid: string | null;
  jlo_vendor_id: string | null;
  woo_vendor_id: string | null;
  vendor: Vendor | null;
  hub_id: string | null;
  hub: Hub | null;
  meta_pricing: {
    supplier_price_usd: string | null;
    landed_cost_usd: string | null;
    exchange_rate: string | null;
    inbound_shipping_usd: string | null;
  };
}

interface ListProduct {
  id: number;
  name: string;
  status: string;
  regular_price: string;
  images: ProductImage[];
  cj_pid: string | null;
  jlo_vendor_id: string | null;
  vendor: Vendor | null;
  hub: Hub | null;
}

interface EditVariation {
  id: number;
  regular_price: string;
  sale_price: string;
  sku: string;
  stock_status: string;
  manage_stock: boolean;
  stock_quantity: string;
}

interface EditState {
  name: string;
  description: string;
  short_description: string;
  regular_price: string;
  sale_price: string;
  sku: string;
  stock_status: string;
  manage_stock: boolean;
  stock_quantity: string;
  weight: string;
  dim_length: string;
  dim_width: string;
  dim_height: string;
  shipping_class: string;
  category_ids: number[];
  tag_ids: number[];
  vendor_id: string;
  hub_id: string;
  variations: EditVariation[];
}

interface WcMeta {
  categories: WcCategory[];
  tags: WcTerm[];
  shippingClasses: WcTerm[];
}

type Tab = 'info' | 'pricing' | 'stock' | 'shipping' | 'media' | 'variations' | 'taxonomy' | 'vendor';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '');
}

function hasImages(html: string): boolean {
  return /<img[\s>]/i.test(html);
}

/** Extract all <img …> tags from an HTML string */
function extractImgTags(html: string): string {
  return (html.match(/<img[^>]*\/?>/gi) || []).join('\n');
}

/** Remove all <img …> tags from an HTML string */
function stripImgTags(html: string): string {
  return html.replace(/<img[^>]*\/?>/gi, '');
}

/** Convert HTML to editable plain text (preserves line structure, decodes entities) */
function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Convert plain text back to simple HTML paragraphs, then append preserved img tags */
function plainTextToHtml(text: string, imgHtml: string): string {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((para) => para.trim())
    .filter(Boolean)
    .map((para) => `<p>${para.replace(/\n/g, '<br />')}</p>`)
    .join('\n');
  return imgHtml ? `${paragraphs}\n${imgHtml}` : paragraphs;
}

function formatNgn(price: string): string {
  if (!price) return '—';
  const n = Number(price);
  if (isNaN(n)) return price;
  return `₦${n.toLocaleString('en-NG')}`;
}

// ─── Input Components ─────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {children}
    </div>
  );
}

const inputCls =
  'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent';
const selectCls =
  'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white';

// ─── Main Component ───────────────────────────────────────────────────────────

export function ProductModerationPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  // List
  const [listProducts, setListProducts] = useState<ListProduct[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  // Selected product detail
  const [detail, setDetail] = useState<ProductDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // WC taxonomy meta (categories, tags, shipping classes)
  const [wcMeta, setWcMeta] = useState<WcMeta>({ categories: [], tags: [], shippingClasses: [] });
  const [wcMetaLoading, setWcMetaLoading] = useState(false);

  // Vendors & Hubs
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [hubs, setHubs] = useState<Hub[]>([]);

  // Edit state
  const [edit, setEdit] = useState<EditState | null>(null);
  const [dirty, setDirty] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('info');

  // Image viewer
  const [imageIndex, setImageIndex] = useState(0);

  // Description edit mode: 'text' = plain-text editor, 'html' = raw HTML editor, 'preview' = rendered view
  const [descMode, setDescMode] = useState<'text' | 'html' | 'preview'>('text');
  // Extracted <img> tags preserved separately so plain-text editing doesn't destroy them
  const [descImages, setDescImages] = useState('');

  // Actions
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // ── Auth header ─────────────────────────────────────────────────────────────
  const getAuthHeader = useCallback(async (): Promise<string> => {
    const { data } = await supabase.auth.getSession();
    return `Bearer ${data.session?.access_token || ''}`;
  }, []);

  // ── Fetch list (with 1 auto-retry on network/timeout errors) ───────────────
  const fetchList = useCallback(
    async (p: number, attempt = 1) => {
      setListLoading(true);
      setListError(null);
      try {
        const res = await fetch(
          `/.netlify/functions/product-moderation-list?page=${p}&per_page=10`,
          { headers: { Authorization: await getAuthHeader() } }
        );
        if (res.status === 401) throw new Error('Session expired — please refresh the page');
        if (res.status === 403) throw new Error('Access denied');
        if (res.status === 504 || res.status === 502) throw new Error('__timeout__');
        const json = await res.json();
        if (!json.success) throw new Error(json.message || json.error || `Server error (${res.status})`);
        setListProducts(json.data);
        setHasMore(json.data.length === 10);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to load';
        // Auto-retry once on timeout/network failure
        if ((msg === '__timeout__' || msg === 'Failed to fetch') && attempt < 2) {
          setTimeout(() => fetchList(p, 2), 2000);
          return;
        }
        setListError(
          msg === '__timeout__'
            ? 'Request timed out — WooCommerce is slow to respond. Click Refresh to try again.'
            : msg === 'Failed to fetch'
            ? 'Network error — check your connection and click Refresh.'
            : msg
        );
      } finally {
        setListLoading(false);
      }
    },
    [getAuthHeader]
  );

  useEffect(() => {
    fetchList(page);
  }, [fetchList, page]);

  // ── Fetch WC taxonomy meta ──────────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      setWcMetaLoading(true);
      try {
        const res = await fetch('/.netlify/functions/product-moderation-meta', {
          headers: { Authorization: await getAuthHeader() },
        });
        const json = await res.json();
        if (json.success) setWcMeta(json.data);
      } catch {
        // non-critical
      } finally {
        setWcMetaLoading(false);
      }
    };
    load();
  }, [getAuthHeader]);

  // ── Fetch vendors + hubs ────────────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      try {
        const [vendorRes, hubRes] = await Promise.all([
          supabase.from('vendors').select('id, store_name, woocommerce_vendor_id').order('store_name'),
          supabase.from('hubs').select('id, name, code').order('name'),
        ]);
        setVendors(vendorRes.data || []);
        setHubs(hubRes.data || []);
      } catch {
        // non-critical
      }
    };
    load();
  }, []);

  // ── Select product → fetch detail ──────────────────────────────────────────
  const selectProduct = useCallback(
    async (id: number) => {
      setDetail(null);
      setEdit(null);
      setDirty(false);
      setDetailError(null);
      setActionError(null);
      setActionSuccess(null);
      setActiveTab('info');
      setImageIndex(0);
      setDescMode('text');
      setDescImages('');
      setDetailLoading(true);
      try {
        const res = await fetch(`/.netlify/functions/product-moderation-detail?id=${id}`, {
          headers: { Authorization: await getAuthHeader() },
        });
        if (res.status === 401) throw new Error('Session expired — please refresh the page');
        if (res.status === 504 || res.status === 502) throw new Error('Request timed out — WooCommerce is slow. Try again in a moment.');
        const json = await res.json();
        if (!json.success) throw new Error(json.message || json.error || `Server error (${res.status})`);
        const d: ProductDetail = json.data;
        setDetail(d);
        // Extract embedded images so plain-text editing doesn't destroy them
        const imgs = extractImgTags(d.description);
        setDescImages(imgs);
        setEdit({
          name: d.name,
          description: htmlToPlainText(stripImgTags(d.description)),
          short_description: stripHtml(d.short_description),
          regular_price: d.regular_price,
          sale_price: d.sale_price,
          sku: d.sku,
          stock_status: d.stock_status || 'instock',
          manage_stock: d.manage_stock || false,
          stock_quantity: d.stock_quantity !== null ? String(d.stock_quantity) : '',
          weight: d.weight,
          dim_length: d.dimensions.length,
          dim_width: d.dimensions.width,
          dim_height: d.dimensions.height,
          shipping_class: d.shipping_class,
          category_ids: d.categories.map((c) => c.id),
          tag_ids: d.tags.map((t) => t.id),
          vendor_id: d.jlo_vendor_id || '',
          hub_id: d.hub_id || '',
          variations: d.variations.map((v) => ({
            id: v.id,
            regular_price: v.regular_price,
            sale_price: v.sale_price,
            sku: v.sku,
            stock_status: v.stock_status || 'instock',
            manage_stock: v.manage_stock || false,
            stock_quantity: v.stock_quantity !== null ? String(v.stock_quantity) : '',
          })),
        });
      } catch (err: unknown) {
        setDetailError(err instanceof Error ? err.message : 'Failed to load product');
      } finally {
        setDetailLoading(false);
      }
    },
    [getAuthHeader]
  );

  // ── Edit helpers ────────────────────────────────────────────────────────────
  const setField = <K extends keyof EditState>(key: K, value: EditState[K]) => {
    setEdit((prev) => (prev ? { ...prev, [key]: value } : prev));
    setDirty(true);
    setActionSuccess(null);
  };

  const setVariationField = (idx: number, key: keyof EditVariation, value: string | boolean) => {
    setEdit((prev) => {
      if (!prev) return prev;
      const variations = prev.variations.map((v, i) =>
        i === idx ? { ...v, [key]: value } : v
      );
      return { ...prev, variations };
    });
    setDirty(true);
    setActionSuccess(null);
  };

  const toggleCategory = (id: number) => {
    setEdit((prev) => {
      if (!prev) return prev;
      const ids = prev.category_ids.includes(id)
        ? prev.category_ids.filter((c) => c !== id)
        : [...prev.category_ids, id];
      return { ...prev, category_ids: ids };
    });
    setDirty(true);
  };

  const toggleTag = (id: number) => {
    setEdit((prev) => {
      if (!prev) return prev;
      const ids = prev.tag_ids.includes(id)
        ? prev.tag_ids.filter((t) => t !== id)
        : [...prev.tag_ids, id];
      return { ...prev, tag_ids: ids };
    });
    setDirty(true);
  };

  // ── Build save payload ──────────────────────────────────────────────────────
  const buildPayload = (publish = false) => {
    if (!detail || !edit) return null;
    // Reconstruct final HTML: in 'text' mode combine plain text + preserved img tags;
    // in 'html' mode the raw HTML is already in edit.description.
    const finalDescription =
      descMode === 'html'
        ? edit.description
        : plainTextToHtml(edit.description, descImages);
    return {
      woo_product_id: detail.id,
      name: edit.name,
      description: finalDescription,
      short_description: edit.short_description,
      regular_price: edit.regular_price,
      sale_price: edit.sale_price,
      sku: edit.sku,
      stock_status: edit.stock_status,
      manage_stock: edit.manage_stock,
      stock_quantity: edit.manage_stock ? edit.stock_quantity : undefined,
      weight: edit.weight,
      dimensions: { length: edit.dim_length, width: edit.dim_width, height: edit.dim_height },
      shipping_class: edit.shipping_class,
      categories: edit.category_ids.map((id) => ({ id })),
      tags: edit.tag_ids.map((id) => ({ id })),
      vendor_id: edit.vendor_id || undefined,
      hub_id: edit.hub_id || undefined,
      variations: edit.variations.length > 0 ? edit.variations : undefined,
      publish,
    };
  };

  // ── Save ────────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!detail || !edit) return;
    setSaving(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      const res = await fetch('/.netlify/functions/product-moderation-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: await getAuthHeader() },
        body: JSON.stringify(buildPayload(false)),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || json.error);
      setActionSuccess('Saved');
      setDirty(false);
      // Sync list entry
      setListProducts((prev) =>
        prev.map((p) =>
          p.id === detail.id
            ? { ...p, name: edit.name, regular_price: edit.regular_price, vendor: json.data.vendor || p.vendor, hub: json.data.hub || p.hub }
            : p
        )
      );
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  // ── Publish ─────────────────────────────────────────────────────────────────
  const handlePublish = async () => {
    if (!detail || !edit || !isAdmin) return;
    if (!edit.vendor_id) {
      setActionError('Assign a vendor before publishing');
      setActiveTab('vendor');
      return;
    }
    setPublishing(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      const res = await fetch('/.netlify/functions/product-moderation-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: await getAuthHeader() },
        body: JSON.stringify(buildPayload(true)),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || json.error);
      setActionSuccess('Published');
      setDirty(false);
      setListProducts((prev) => prev.filter((p) => p.id !== detail.id));
      setDetail(null);
      setEdit(null);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Publish failed');
    } finally {
      setPublishing(false);
    }
  };

  // ─── Tabs config ─────────────────────────────────────────────────────────────
  const isVariable = detail?.type === 'variable';
  const tabs = (
    [
      { id: 'info' as Tab, label: 'Info' },
      { id: 'pricing' as Tab, label: 'Pricing' },
      { id: 'stock' as Tab, label: 'Stock' },
      { id: 'shipping' as Tab, label: 'Shipping' },
      { id: 'media' as Tab, label: 'Media' },
      { id: 'variations' as Tab, label: `Variations${isVariable ? ` (${detail?.variations.length ?? 0})` : ''}`, hidden: !isVariable },
      { id: 'taxonomy' as Tab, label: 'Categories & Tags' },
      { id: 'vendor' as Tab, label: 'Assignment' },
    ] as Array<{ id: Tab; label: string; hidden?: boolean }>
  ).filter((t) => !t.hidden);

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      {/* Page header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Product Moderation</h1>
          <p className="text-sm text-gray-500 mt-1">Review and publish CJ-imported draft products</p>
        </div>
        <button
          onClick={() => fetchList(page)}
          disabled={listLoading}
          className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${listLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="flex flex-col lg:flex-row gap-6 flex-1 min-h-0">
        {/* ── Left: product list ──────────────────────────────────────────── */}
        <div className="w-full lg:w-72 xl:w-80 shrink-0 flex flex-col">
          <div className="bg-white rounded-xl border border-gray-200 flex flex-col flex-1 min-h-0">
            <div className="px-4 py-3 border-b border-gray-200 shrink-0 flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-700">
                Draft Products
                {!listLoading && (
                  <span className="ml-1 text-xs font-normal text-gray-400">({listProducts.length})</span>
                )}
              </span>
            </div>

            {listLoading ? (
              <div className="flex-1 flex items-center justify-center py-16">
                <Loader2 className="w-6 h-6 animate-spin text-primary-600" />
              </div>
            ) : listError ? (
              <div className="flex-1 flex flex-col items-center justify-center px-4 py-12 text-center">
                <AlertCircle className="w-8 h-8 text-red-400 mb-2" />
                <p className="text-sm text-red-600">{listError}</p>
              </div>
            ) : listProducts.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center px-4 py-12 text-center">
                <Package className="w-8 h-8 text-gray-300 mb-2" />
                <p className="text-sm text-gray-500">No draft products pending review</p>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
                {listProducts.map((p) => {
                  const isActive = detail?.id === p.id;
                  const thumb = p.images[0]?.src;
                  return (
                    <button
                      key={p.id}
                      onClick={() => selectProduct(p.id)}
                      className={`w-full flex items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50 ${
                        isActive ? 'bg-primary-50 border-l-2 border-primary-600' : ''
                      }`}
                    >
                      <div className="w-11 h-11 rounded-lg overflow-hidden shrink-0 bg-gray-100 flex items-center justify-center">
                        {thumb ? (
                          <img src={thumb} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <ImageOff className="w-4 h-4 text-gray-300" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 line-clamp-2 leading-snug">
                          {p.name}
                        </p>
                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                          <span className="text-xs text-gray-500">{formatNgn(p.regular_price)}</span>
                          {p.vendor ? (
                            <span className="text-xs px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded">
                              {p.vendor.store_name}
                            </span>
                          ) : (
                            <span className="text-xs px-1.5 py-0.5 bg-yellow-50 text-yellow-700 rounded">
                              No vendor
                            </span>
                          )}
                          {p.hub && (
                            <span className="text-xs px-1.5 py-0.5 bg-purple-50 text-purple-700 rounded">
                              {p.hub.code}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {(page > 1 || hasMore) && (
              <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between shrink-0">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1 || listLoading}
                  className="flex items-center gap-1 text-xs text-gray-600 disabled:opacity-40"
                >
                  <ChevronLeft className="w-4 h-4" /> Prev
                </button>
                <span className="text-xs text-gray-500">Page {page}</span>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={!hasMore || listLoading}
                  className="flex items-center gap-1 text-xs text-gray-600 disabled:opacity-40"
                >
                  Next <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ── Right: editor ───────────────────────────────────────────────── */}
        <div className="flex-1 min-w-0">
          {detailLoading ? (
            <div className="h-full flex items-center justify-center bg-white rounded-xl border border-gray-200">
              <Loader2 className="w-7 h-7 animate-spin text-primary-600" />
            </div>
          ) : detailError ? (
            <div className="h-full flex flex-col items-center justify-center bg-white rounded-xl border border-gray-200">
              <AlertCircle className="w-8 h-8 text-red-400 mb-2" />
              <p className="text-sm text-red-600">{detailError}</p>
            </div>
          ) : !detail || !edit ? (
            <div className="h-full flex flex-col items-center justify-center bg-white rounded-xl border border-gray-200 border-dashed">
              <Package className="w-10 h-10 text-gray-300 mb-3" />
              <p className="text-sm text-gray-500">Select a product to review and edit</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 flex flex-col h-full">
              {/* Editor header */}
              <div className="px-5 py-4 border-b border-gray-200 flex items-start justify-between gap-4 shrink-0">
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-gray-900 truncate">{detail.name}</h2>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full">
                      WC #{detail.id}
                    </span>
                    <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full capitalize">
                      {detail.type}
                    </span>
                    {detail.cj_pid && (
                      <span className="text-xs px-2 py-0.5 bg-orange-50 text-orange-700 rounded-full flex items-center gap-1">
                        <Tag className="w-3 h-3" /> CJ: {detail.cj_pid}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={handleSave}
                    disabled={saving || publishing || !dirty}
                    className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Save Draft
                  </button>
                  {isAdmin && (
                    <button
                      onClick={handlePublish}
                      disabled={saving || publishing}
                      className="flex items-center gap-2 px-3 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {publishing ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <CheckCircle className="w-4 h-4" />
                      )}
                      Approve & Publish
                    </button>
                  )}
                </div>
              </div>

              {/* Action feedback */}
              {(actionError || actionSuccess) && (
                <div
                  className={`mx-5 mt-3 px-4 py-2 rounded-lg text-sm flex items-center gap-2 shrink-0 ${
                    actionError
                      ? 'bg-red-50 text-red-700 border border-red-200'
                      : 'bg-green-50 text-green-700 border border-green-200'
                  }`}
                >
                  {actionError ? (
                    <AlertCircle className="w-4 h-4 shrink-0" />
                  ) : (
                    <CheckCircle className="w-4 h-4 shrink-0" />
                  )}
                  <span className="flex-1">{actionError || actionSuccess}</span>
                  <button onClick={() => { setActionError(null); setActionSuccess(null); }}>
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              {/* Tabs */}
              <div className="px-5 border-b border-gray-200 shrink-0 overflow-x-auto">
                <div className="flex gap-0 min-w-max">
                  {tabs.map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap -mb-px ${
                        activeTab === tab.id
                          ? 'border-primary-600 text-primary-700'
                          : 'border-transparent text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tab content */}
              <div className="flex-1 overflow-y-auto p-5">

                {/* ── INFO ── */}
                {activeTab === 'info' && (
                  <div className="space-y-5 max-w-2xl">
                    <Field label="Product Title">
                      <input
                        type="text"
                        value={edit.name}
                        onChange={(e) => setField('name', e.target.value)}
                        className={inputCls}
                      />
                    </Field>
                    <Field label="Short Description">
                      <textarea
                        value={edit.short_description}
                        onChange={(e) => setField('short_description', e.target.value)}
                        rows={3}
                        className={`${inputCls} resize-y`}
                        placeholder="Brief product summary shown in listings"
                      />
                    </Field>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-sm font-medium text-gray-700">Full Description</label>
                        <div className="flex items-center gap-2">
                          {descImages && (
                            <span className="text-xs text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">
                              ✓ Images preserved
                            </span>
                          )}
                          {/* Mode toggle pills */}
                          <div className="flex rounded-md border border-gray-200 overflow-hidden text-xs">
                            {(['text', 'html', 'preview'] as const).map((mode) => (
                              <button
                                key={mode}
                                type="button"
                                onClick={() => {
                                  if (mode === descMode) return;
                                  if (mode === 'html') {
                                    // Switch to HTML: rebuild full HTML from current text + images
                                    setField('description', plainTextToHtml(edit.description, descImages));
                                    setDescImages('');
                                  } else if (mode === 'text') {
                                    // Switch to text: extract images from current HTML, show plain text
                                    const imgs = extractImgTags(edit.description);
                                    setDescImages(imgs);
                                    setField('description', htmlToPlainText(stripImgTags(edit.description)));
                                  }
                                  setDescMode(mode);
                                }}
                                className={`px-2 py-1 capitalize transition-colors ${
                                  descMode === mode
                                    ? 'bg-primary-600 text-white'
                                    : 'bg-white text-gray-600 hover:bg-gray-50'
                                }`}
                              >
                                {mode === 'text' ? 'Plain Text' : mode === 'html' ? 'HTML' : 'Preview'}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>

                      {descMode === 'html' ? (
                        <textarea
                          value={edit.description}
                          onChange={(e) => setField('description', e.target.value)}
                          rows={12}
                          className={`${inputCls} resize-y font-mono text-xs`}
                          placeholder="HTML description"
                          spellCheck={false}
                        />
                      ) : descMode === 'text' ? (
                        <textarea
                          value={edit.description}
                          onChange={(e) => setField('description', e.target.value)}
                          rows={12}
                          className={`${inputCls} resize-y`}
                          placeholder="Type the product description here. Images embedded by CJ are automatically preserved."
                        />
                      ) : (
                        /* Preview mode — reconstruct full HTML with images for display */
                        <div
                          className="w-full min-h-32 border border-gray-200 rounded-lg p-3 text-sm text-gray-700 overflow-auto prose prose-sm max-w-none bg-gray-50"
                          style={{ maxHeight: '420px' }}
                          dangerouslySetInnerHTML={{
                            __html: plainTextToHtml(edit.description, descImages) || '<span class="text-gray-400">No description</span>',
                          }}
                        />
                      )}
                    </div>
                    {/* CJ pricing reference */}
                    {(detail.meta_pricing.supplier_price_usd || detail.meta_pricing.landed_cost_usd) && (
                      <div className="p-4 bg-orange-50 border border-orange-200 rounded-lg text-sm space-y-1">
                        <p className="font-medium text-orange-800">CJ Cost Reference (read-only)</p>
                        {detail.meta_pricing.supplier_price_usd && (
                          <p className="text-orange-700">Supplier price: ${detail.meta_pricing.supplier_price_usd} USD</p>
                        )}
                        {detail.meta_pricing.inbound_shipping_usd && (
                          <p className="text-orange-700">Inbound shipping: ${detail.meta_pricing.inbound_shipping_usd} USD</p>
                        )}
                        {detail.meta_pricing.landed_cost_usd && (
                          <p className="text-orange-700">Landed cost: ${detail.meta_pricing.landed_cost_usd} USD</p>
                        )}
                        {detail.meta_pricing.exchange_rate && (
                          <p className="text-orange-700">Rate used: ₦{detail.meta_pricing.exchange_rate}/$</p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* ── PRICING ── */}
                {activeTab === 'pricing' && (
                  <div className="space-y-5 max-w-md">
                    {detail.type === 'variable' && (
                      <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">
                        This is a variable product. Set prices per variation in the Variations tab.
                      </div>
                    )}
                    <Field label="SKU">
                      <input
                        type="text"
                        value={edit.sku}
                        onChange={(e) => setField('sku', e.target.value)}
                        className={inputCls}
                        placeholder="Stock keeping unit"
                      />
                    </Field>
                    <Field label="Regular Price (₦)">
                      <input
                        type="number"
                        value={edit.regular_price}
                        onChange={(e) => setField('regular_price', e.target.value)}
                        className={inputCls}
                        min="0"
                        step="1"
                        placeholder="0"
                      />
                      {edit.regular_price && (
                        <p className="text-xs text-gray-500 mt-1">{formatNgn(edit.regular_price)}</p>
                      )}
                    </Field>
                    <Field label="Sale Price (₦) — optional">
                      <input
                        type="number"
                        value={edit.sale_price}
                        onChange={(e) => setField('sale_price', e.target.value)}
                        className={inputCls}
                        min="0"
                        step="1"
                        placeholder="Leave blank if no sale"
                      />
                      {edit.sale_price && (
                        <p className="text-xs text-gray-500 mt-1">{formatNgn(edit.sale_price)}</p>
                      )}
                    </Field>
                  </div>
                )}

                {/* ── STOCK ── */}
                {activeTab === 'stock' && (
                  <div className="space-y-5 max-w-md">
                    <Field label="Stock Status">
                      <select
                        value={edit.stock_status}
                        onChange={(e) => setField('stock_status', e.target.value)}
                        className={selectCls}
                      >
                        <option value="instock">In Stock</option>
                        <option value="outofstock">Out of Stock</option>
                        <option value="onbackorder">On Backorder</option>
                      </select>
                    </Field>
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        id="manage_stock"
                        checked={edit.manage_stock}
                        onChange={(e) => setField('manage_stock', e.target.checked)}
                        className="w-4 h-4 rounded border-gray-300 text-primary-600"
                      />
                      <label htmlFor="manage_stock" className="text-sm font-medium text-gray-700">
                        Manage stock quantity
                      </label>
                    </div>
                    {edit.manage_stock && (
                      <Field label="Stock Quantity">
                        <input
                          type="number"
                          value={edit.stock_quantity}
                          onChange={(e) => setField('stock_quantity', e.target.value)}
                          className={inputCls}
                          min="0"
                          step="1"
                          placeholder="0"
                        />
                      </Field>
                    )}
                  </div>
                )}

                {/* ── SHIPPING ── */}
                {activeTab === 'shipping' && (
                  <div className="space-y-5 max-w-md">
                    <Field label="Shipping Class">
                      {wcMetaLoading ? (
                        <div className="flex items-center gap-2 text-sm text-gray-500">
                          <Loader2 className="w-4 h-4 animate-spin" /> Loading...
                        </div>
                      ) : (
                        <select
                          value={edit.shipping_class}
                          onChange={(e) => setField('shipping_class', e.target.value)}
                          className={selectCls}
                        >
                          <option value="">No shipping class</option>
                          {wcMeta.shippingClasses.map((sc) => (
                            <option key={sc.id} value={sc.slug}>
                              {sc.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </Field>
                    <Field label="Weight (kg)">
                      <input
                        type="text"
                        value={edit.weight}
                        onChange={(e) => setField('weight', e.target.value)}
                        className={inputCls}
                        placeholder="e.g. 0.5"
                      />
                    </Field>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Dimensions (cm)
                      </label>
                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <input
                            type="text"
                            value={edit.dim_length}
                            onChange={(e) => setField('dim_length', e.target.value)}
                            className={inputCls}
                            placeholder="Length"
                          />
                          <p className="text-xs text-gray-400 mt-1 text-center">Length</p>
                        </div>
                        <div>
                          <input
                            type="text"
                            value={edit.dim_width}
                            onChange={(e) => setField('dim_width', e.target.value)}
                            className={inputCls}
                            placeholder="Width"
                          />
                          <p className="text-xs text-gray-400 mt-1 text-center">Width</p>
                        </div>
                        <div>
                          <input
                            type="text"
                            value={edit.dim_height}
                            onChange={(e) => setField('dim_height', e.target.value)}
                            className={inputCls}
                            placeholder="Height"
                          />
                          <p className="text-xs text-gray-400 mt-1 text-center">Height</p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── MEDIA ── */}
                {activeTab === 'media' && (
                  <div>
                    {detail.images.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-16 text-center">
                        <ImageOff className="w-10 h-10 text-gray-300 mb-2" />
                        <p className="text-sm text-gray-500">No images on this product</p>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="relative bg-gray-100 rounded-xl overflow-hidden" style={{ maxHeight: '360px' }}>
                          <img
                            src={detail.images[imageIndex]?.src}
                            alt={detail.images[imageIndex]?.alt || ''}
                            className="w-full h-full object-contain"
                            style={{ maxHeight: '360px' }}
                          />
                          {detail.images.length > 1 && (
                            <>
                              <button
                                onClick={() => setImageIndex((i) => Math.max(0, i - 1))}
                                disabled={imageIndex === 0}
                                className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-white/80 rounded-full flex items-center justify-center shadow disabled:opacity-30"
                              >
                                <ChevronLeft className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => setImageIndex((i) => Math.min(detail.images.length - 1, i + 1))}
                                disabled={imageIndex === detail.images.length - 1}
                                className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-white/80 rounded-full flex items-center justify-center shadow disabled:opacity-30"
                              >
                                <ChevronRight className="w-4 h-4" />
                              </button>
                              <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-xs bg-black/50 text-white px-2 py-0.5 rounded-full">
                                {imageIndex + 1} / {detail.images.length}
                              </div>
                            </>
                          )}
                        </div>
                        {detail.images.length > 1 && (
                          <div className="flex gap-2 flex-wrap">
                            {detail.images.map((img, idx) => (
                              <button
                                key={idx}
                                onClick={() => setImageIndex(idx)}
                                className={`w-16 h-16 rounded-lg overflow-hidden border-2 transition-colors ${
                                  idx === imageIndex ? 'border-primary-600' : 'border-gray-200 hover:border-gray-400'
                                }`}
                              >
                                <img src={img.src} alt="" className="w-full h-full object-cover" />
                              </button>
                            ))}
                          </div>
                        )}
                        <p className="text-xs text-gray-500">
                          {detail.images.length} image{detail.images.length !== 1 ? 's' : ''}. Images are managed in WooCommerce.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* ── VARIATIONS ── */}
                {activeTab === 'variations' && isVariable && (
                  <div className="space-y-4">
                    {edit.variations.length === 0 ? (
                      <p className="text-sm text-gray-500">No variations found.</p>
                    ) : (
                      edit.variations.map((v, idx) => {
                        const source = detail.variations[idx];
                        const attrLabel = source?.attributes.map((a) => `${a.name}: ${a.option}`).join(' / ') || `Variation #${v.id}`;
                        return (
                          <div key={v.id} className="border border-gray-200 rounded-xl p-4 space-y-4">
                            <div className="flex items-center gap-3">
                              {source?.image && (
                                <img
                                  src={source.image.src}
                                  alt=""
                                  className="w-12 h-12 rounded-lg object-cover border border-gray-200"
                                />
                              )}
                              <div>
                                <p className="text-sm font-semibold text-gray-800">{attrLabel}</p>
                                <p className="text-xs text-gray-400">ID #{v.id}</p>
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                              <Field label="SKU">
                                <input
                                  type="text"
                                  value={v.sku}
                                  onChange={(e) => setVariationField(idx, 'sku', e.target.value)}
                                  className={inputCls}
                                  placeholder="SKU"
                                />
                              </Field>
                              <Field label="Stock Status">
                                <select
                                  value={v.stock_status}
                                  onChange={(e) => setVariationField(idx, 'stock_status', e.target.value)}
                                  className={selectCls}
                                >
                                  <option value="instock">In Stock</option>
                                  <option value="outofstock">Out of Stock</option>
                                  <option value="onbackorder">On Backorder</option>
                                </select>
                              </Field>
                              <Field label="Regular Price (₦)">
                                <input
                                  type="number"
                                  value={v.regular_price}
                                  onChange={(e) => setVariationField(idx, 'regular_price', e.target.value)}
                                  className={inputCls}
                                  min="0"
                                  step="1"
                                />
                                {v.regular_price && (
                                  <p className="text-xs text-gray-500 mt-1">{formatNgn(v.regular_price)}</p>
                                )}
                              </Field>
                              <Field label="Sale Price (₦)">
                                <input
                                  type="number"
                                  value={v.sale_price}
                                  onChange={(e) => setVariationField(idx, 'sale_price', e.target.value)}
                                  className={inputCls}
                                  min="0"
                                  step="1"
                                  placeholder="Optional"
                                />
                              </Field>
                            </div>
                            <div className="flex items-center gap-3">
                              <input
                                type="checkbox"
                                id={`var_manage_${idx}`}
                                checked={v.manage_stock}
                                onChange={(e) => setVariationField(idx, 'manage_stock', e.target.checked)}
                                className="w-4 h-4 rounded border-gray-300 text-primary-600"
                              />
                              <label htmlFor={`var_manage_${idx}`} className="text-sm text-gray-700">
                                Manage stock
                              </label>
                              {v.manage_stock && (
                                <input
                                  type="number"
                                  value={v.stock_quantity}
                                  onChange={(e) => setVariationField(idx, 'stock_quantity', e.target.value)}
                                  className="w-24 px-2 py-1.5 border border-gray-300 rounded-lg text-sm"
                                  placeholder="Qty"
                                  min="0"
                                />
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}

                {/* ── TAXONOMY ── */}
                {activeTab === 'taxonomy' && (
                  <div className="space-y-6 max-w-2xl">
                    {/* Categories */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Categories
                      </label>
                      {wcMetaLoading ? (
                        <div className="flex items-center gap-2 text-sm text-gray-500">
                          <Loader2 className="w-4 h-4 animate-spin" /> Loading...
                        </div>
                      ) : wcMeta.categories.length === 0 ? (
                        <p className="text-sm text-gray-500">No categories found in WooCommerce.</p>
                      ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-64 overflow-y-auto border border-gray-200 rounded-lg p-3">
                          {wcMeta.categories.map((c) => (
                            <label key={c.id} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 rounded px-1 py-0.5">
                              <input
                                type="checkbox"
                                checked={edit.category_ids.includes(c.id)}
                                onChange={() => toggleCategory(c.id)}
                                className="w-4 h-4 rounded border-gray-300 text-primary-600"
                              />
                              <span className="text-sm text-gray-700 truncate">{c.name}</span>
                            </label>
                          ))}
                        </div>
                      )}
                      {edit.category_ids.length > 0 && (
                        <p className="text-xs text-gray-500 mt-1">{edit.category_ids.length} selected</p>
                      )}
                    </div>

                    {/* Tags */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Tags</label>
                      {wcMetaLoading ? (
                        <div className="flex items-center gap-2 text-sm text-gray-500">
                          <Loader2 className="w-4 h-4 animate-spin" /> Loading...
                        </div>
                      ) : wcMeta.tags.length === 0 ? (
                        <p className="text-sm text-gray-500">No tags found in WooCommerce.</p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {wcMeta.tags.map((t) => {
                            const active = edit.tag_ids.includes(t.id);
                            return (
                              <button
                                key={t.id}
                                onClick={() => toggleTag(t.id)}
                                className={`px-3 py-1 rounded-full text-sm border transition-colors ${
                                  active
                                    ? 'bg-primary-600 text-white border-primary-600'
                                    : 'bg-white text-gray-700 border-gray-300 hover:border-primary-400'
                                }`}
                              >
                                {t.name}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* ── VENDOR ── */}
                {activeTab === 'vendor' && (
                  <div className="space-y-6 max-w-md">

                    {/* Hub */}
                    <div className="space-y-3">
                      <h3 className="text-sm font-semibold text-gray-800 border-b border-gray-200 pb-2">
                        Receiving Hub
                      </h3>
                      <Field label="Assign Hub">
                        <select
                          value={edit.hub_id}
                          onChange={(e) => setField('hub_id', e.target.value)}
                          className={selectCls}
                        >
                          <option value="">— No hub assigned —</option>
                          {hubs.map((h) => (
                            <option key={h.id} value={h.id}>
                              {h.name} ({h.code})
                            </option>
                          ))}
                        </select>
                      </Field>
                      <div className="p-3 bg-gray-50 rounded-lg text-sm">
                        {detail.hub ? (
                          <p className="text-gray-700">
                            Current: <span className="font-medium">{detail.hub.name}</span>
                            <span className="ml-1 text-gray-500">({detail.hub.code})</span>
                          </p>
                        ) : detail.hub_id ? (
                          <p className="text-yellow-700">Hub ID set but not resolved: <span className="font-mono text-xs">{detail.hub_id}</span></p>
                        ) : (
                          <p className="text-yellow-600">No hub assigned</p>
                        )}
                      </div>
                    </div>

                    {/* Vendor */}
                    <div className="space-y-3">
                      <h3 className="text-sm font-semibold text-gray-800 border-b border-gray-200 pb-2">
                        Vendor Store
                      </h3>
                      <Field label="Assign Vendor">
                        <select
                          value={edit.vendor_id}
                          onChange={(e) => setField('vendor_id', e.target.value)}
                          className={selectCls}
                        >
                          <option value="">— No vendor assigned —</option>
                          {vendors.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.store_name} (WC #{v.woocommerce_vendor_id})
                            </option>
                          ))}
                        </select>
                      </Field>
                      <div className="p-3 bg-gray-50 rounded-lg text-sm">
                        {detail.vendor ? (
                          <>
                            <p className="text-gray-700">
                              Store: <span className="font-medium">{detail.vendor.store_name}</span>
                            </p>
                            <p className="text-gray-500 text-xs mt-0.5">
                              WC vendor ID: {detail.vendor.woocommerce_vendor_id}
                            </p>
                          </>
                        ) : detail.woo_vendor_id ? (
                          <p className="text-gray-600 text-xs">
                            WC vendor ID: <span className="font-mono">{detail.woo_vendor_id}</span>{' '}
                            <span className="text-yellow-600">(not mapped in JLO)</span>
                          </p>
                        ) : (
                          <p className="text-yellow-600">No vendor assigned</p>
                        )}
                      </div>
                    </div>

                    {!isAdmin && (
                      <p className="text-xs text-gray-500 bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2">
                        Only admins can publish. Assign hub + vendor and save the draft for admin review.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
