import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  TrendingUp, RefreshCw, Sparkles, CheckCircle, XCircle,
  Clock, Eye, MousePointer, DollarSign, Users, Plus,
  ChevronDown, ChevronUp, AlertCircle, Megaphone, AlertTriangle,
  Play, Pause, Upload, ImageIcon, X, Search, Send, Trash2,
} from 'lucide-react';

const apiBase = (import.meta as any).env?.VITE_API_BASE_URL || '';
const api = (path: string, opts?: RequestInit) =>
  fetch(`${apiBase}${path}`, {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('sb-access-token') || ''}` },
    ...opts,
  }).then((r) => r.json());

/** Meta rejects ad-set budgets below about ₦3.5k for some setups; ₦4k is a practical floor */
const META_PUBLISH_MIN_DAILY_BUDGET_NGN = 4000;

// ─── Types ────────────────────────────────────────────────────────────────────

interface Campaign {
  id: string;
  meta_campaign_id: string;
  name: string;
  status: string;
  objective: string;
  daily_budget: number | null;
  lifetime_budget: number | null;
  impressions: number;
  reach: number;
  clicks: number;
  spend: number;
  ctr: number;
  cpc: number;
  synced_at: string;
}

interface Draft {
  id: string;
  title: string;
  headline: string;
  body_text: string;
  call_to_action: string;
  image_url?: string | null;
  destination_url?: string | null;
  status: string;
  ai_generated: boolean;
  suggested_budget: number | null;
  created_at: string;
  meta_ad_id?: string | null;
  published_at?: string | null;
  users?: { full_name: string; email: string };
}

interface AiVariation {
  headline: string;
  body_text: string;
  call_to_action: string;
}

interface CatalogProduct {
  id: string;
  name: string;
  price: number;
  description: string;
  image_url: string | null;
  category: string;
  product_url: string | null;
}

interface AdsContext {
  top_region: string | null;
  active_promos: Array<{ code: string; value: number; type: string }>;
}

interface ProductImage {
  src: string;
  alt: string | null;
  product_id: string | null;
  name?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt    = (n: number) => `₦${Number(n || 0).toLocaleString()}`;
const fmtNum = (n: number) => Number(n || 0).toLocaleString();

const STATUS_COLOR: Record<string, string> = {
  ACTIVE:   'bg-green-100 text-green-800',
  PAUSED:   'bg-yellow-100 text-yellow-800',
  ARCHIVED: 'bg-gray-100 text-gray-700',
  DELETED:  'bg-red-100 text-red-700',
  draft:    'bg-gray-100 text-gray-700',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-700',
  published:'bg-blue-100 text-blue-800',
};

function isAlertCampaign(c: Campaign) {
  return Number(c.spend) > 0 && Number(c.ctr) < 1.0;
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, sub, color }: {
  icon: React.ElementType; label: string; value: string; sub?: string; color: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 flex items-start gap-4">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${color}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">{label}</p>
        <p className="text-xl font-bold text-gray-900 mt-0.5">{value}</p>
        {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ─── Campaign card ────────────────────────────────────────────────────────────

function CampaignCard({ campaign, onStatusChange }: {
  campaign: Campaign;
  onStatusChange: (id: string, status: 'ACTIVE' | 'PAUSED') => void;
}) {
  const alert = isAlertCampaign(campaign);
  const budget = campaign.daily_budget || campaign.lifetime_budget || 0;
  const spendPct = budget > 0 ? Math.min(100, (Number(campaign.spend) / budget) * 100) : 0;
  const [toggling, setToggling] = useState(false);

  const handleToggle = async () => {
    setToggling(true);
    const next = campaign.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    await onStatusChange(campaign.meta_campaign_id, next);
    setToggling(false);
  };

  return (
    <div className={`bg-white rounded-xl border ${alert ? 'border-amber-300' : 'border-gray-200'} p-5 space-y-4`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {alert && <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />}
            <p className="font-semibold text-gray-900 text-sm truncate">{campaign.name}</p>
          </div>
          {campaign.objective && (
            <p className="text-xs text-gray-500 mt-0.5 uppercase tracking-wide">{campaign.objective}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLOR[campaign.status] || 'bg-gray-100 text-gray-700'}`}>
            {campaign.status}
          </span>
          {(campaign.status === 'ACTIVE' || campaign.status === 'PAUSED') && (
            <button
              onClick={handleToggle}
              disabled={toggling}
              title={campaign.status === 'ACTIVE' ? 'Pause campaign' : 'Resume campaign'}
              className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors disabled:opacity-50 ${
                campaign.status === 'ACTIVE'
                  ? 'bg-yellow-50 text-yellow-600 hover:bg-yellow-100'
                  : 'bg-green-50 text-green-600 hover:bg-green-100'
              }`}
            >
              {toggling
                ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                : campaign.status === 'ACTIVE'
                  ? <Pause className="w-3.5 h-3.5" />
                  : <Play className="w-3.5 h-3.5" />
              }
            </button>
          )}
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-4 gap-3 text-center">
        <div className="bg-gray-50 rounded-lg py-2.5 px-2">
          <p className="text-xs text-gray-400 mb-0.5">Spend</p>
          <p className="text-sm font-bold text-gray-900">{fmt(campaign.spend)}</p>
        </div>
        <div className="bg-gray-50 rounded-lg py-2.5 px-2">
          <p className="text-xs text-gray-400 mb-0.5">Impressions</p>
          <p className="text-sm font-bold text-gray-900">{fmtNum(campaign.impressions)}</p>
        </div>
        <div className="bg-gray-50 rounded-lg py-2.5 px-2">
          <p className="text-xs text-gray-400 mb-0.5">Clicks</p>
          <p className="text-sm font-bold text-gray-900">{fmtNum(campaign.clicks)}</p>
        </div>
        <div className={`rounded-lg py-2.5 px-2 ${alert ? 'bg-amber-50' : 'bg-gray-50'}`}>
          <p className="text-xs text-gray-400 mb-0.5">CTR</p>
          <p className={`text-sm font-bold ${alert ? 'text-amber-600' : 'text-gray-900'}`}>
            {Number(campaign.ctr || 0).toFixed(2)}%
          </p>
        </div>
      </div>

      {/* Budget bar */}
      {budget > 0 && (
        <div>
          <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
            <span>{campaign.daily_budget ? 'Daily budget' : 'Lifetime budget'}</span>
            <span>{fmt(campaign.spend)} / {fmt(budget)}</span>
          </div>
          <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${spendPct > 85 ? 'bg-red-500' : 'bg-blue-500'}`}
              style={{ width: `${spendPct}%` }}
            />
          </div>
        </div>
      )}

      {alert && (
        <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          Low CTR with active spend — review targeting or creative
        </p>
      )}
    </div>
  );
}

// ─── Facebook Ad Preview ──────────────────────────────────────────────────────

function FbAdPreview({ headline, body, cta, imageUrl }: {
  headline: string; body: string; cta: string; imageUrl?: string;
}) {
  const ctaLabel: Record<string, string> = {
    SHOP_NOW: 'Shop Now', LEARN_MORE: 'Learn More',
    ORDER_NOW: 'Order Now', GET_OFFER: 'Get Offer',
  };
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm max-w-sm mx-auto">
      {/* Top bar */}
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-gray-100">
        <div className="w-9 h-9 rounded-full bg-blue-600 flex items-center justify-center shrink-0">
          <span className="text-white font-bold text-xs">J</span>
        </div>
        <div>
          <p className="text-sm font-semibold text-gray-900">JulineMart</p>
          <p className="text-xs text-gray-400">Sponsored · <span className="text-blue-500">🌍</span></p>
        </div>
      </div>

      {/* Body text */}
      <div className="px-4 py-3">
        <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">{body || 'Ad body text will appear here…'}</p>
      </div>

      {/* Image area */}
      <div className="w-full aspect-[1.91/1] bg-gradient-to-br from-blue-50 to-purple-50 overflow-hidden flex items-center justify-center">
        {imageUrl ? (
          <img src={imageUrl} alt="Ad" className="w-full h-full object-cover" />
        ) : (
          <div className="text-center">
            <ImageIcon className="w-10 h-10 text-gray-300 mx-auto mb-2" />
            <p className="text-xs text-gray-400">No image selected</p>
          </div>
        )}
      </div>

      {/* CTA row */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-t border-gray-100">
        <div className="min-w-0">
          <p className="text-xs text-gray-400 uppercase tracking-wide">julinemart.com</p>
          <p className="text-sm font-semibold text-gray-900 truncate mt-0.5">{headline || 'Headline here'}</p>
        </div>
        <button className="shrink-0 ml-3 bg-blue-600 text-white text-xs font-semibold px-3 py-2 rounded-lg">
          {ctaLabel[cta] || cta || 'Shop Now'}
        </button>
      </div>
    </div>
  );
}

// ─── Image Picker ─────────────────────────────────────────────────────────────

function ImagePicker({ value, onChange }: {
  value: string; onChange: (url: string) => void;
}) {
  const [pickerTab, setPickerTab] = useState<'products' | 'upload'>('products');
  const [productImages, setProductImages] = useState<ProductImage[]>([]);
  const [loadingImages, setLoadingImages] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (pickerTab === 'products' && productImages.length === 0) {
      setLoadingImages(true);
      api('/api/meta/products-images')
        .then((res) => { if (res.success) setProductImages(res.data); })
        .finally(() => setLoadingImages(false));
    }
  }, [pickerTab]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) { setUploadError('File must be 4 MB or smaller'); return; }
    setUploadError('');
    setUploading(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(',')[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const res = await api('/api/meta/upload-image', {
        method: 'POST',
        body: JSON.stringify({ file_base64: base64, content_type: file.type }),
      });
      if (res.success) onChange(res.data.url);
      else setUploadError(res.error || 'Upload failed');
    } catch { setUploadError('Upload failed'); }
    finally { setUploading(false); }
  };

  return (
    <div className="space-y-3">
      {/* Tab selector */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit text-xs">
        <button
          onClick={() => setPickerTab('products')}
          className={`px-3 py-1.5 rounded-md font-medium transition-colors ${pickerTab === 'products' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600'}`}
        >
          From Products
        </button>
        <button
          onClick={() => setPickerTab('upload')}
          className={`px-3 py-1.5 rounded-md font-medium transition-colors ${pickerTab === 'upload' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600'}`}
        >
          Upload Image
        </button>
      </div>

      {pickerTab === 'products' && (
        <div>
          {loadingImages ? (
            <p className="text-xs text-gray-500 py-2">Loading product images…</p>
          ) : productImages.length === 0 ? (
            <p className="text-xs text-gray-500 py-2">No product images found.</p>
          ) : (
            <div className="grid grid-cols-4 gap-2 max-h-48 overflow-y-auto">
              {productImages.map((img, i) => (
                <button
                  key={i}
                  onClick={() => onChange(img.src)}
                  title={img.name || img.alt || ''}
                  className={`aspect-square rounded-lg overflow-hidden border-2 transition-all ${value === img.src ? 'border-blue-500' : 'border-transparent hover:border-gray-300'}`}
                >
                  <img src={img.src} alt={img.alt || img.name || ''} className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {pickerTab === 'upload' && (
        <div>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleFileUpload} />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-2 border border-dashed border-gray-300 rounded-lg px-4 py-3 text-sm text-gray-600 hover:border-blue-400 hover:text-blue-600 transition-colors disabled:opacity-50 w-full justify-center"
          >
            <Upload className="w-4 h-4" />
            {uploading ? 'Uploading…' : 'Click to upload (JPG / PNG / WebP, max 4 MB)'}
          </button>
          {uploadError && <p className="text-xs text-red-600 mt-1">{uploadError}</p>}
        </div>
      )}

      {/* Selected preview */}
      {value && (
        <div className="flex items-center gap-2">
          <img src={value} alt="selected" className="w-12 h-12 rounded-lg object-cover border border-gray-200" />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-gray-600 truncate">{value.split('/').pop()}</p>
          </div>
          <button onClick={() => onChange('')} className="text-gray-400 hover:text-red-500 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Product Search Combobox ──────────────────────────────────────────────────

function ProductSearchCombobox({ selected, onChange }: {
  selected: CatalogProduct[];
  onChange: (products: CatalogProduct[]) => void;
}) {
  const [query, setQuery]           = useState('');
  const [results, setResults]       = useState<CatalogProduct[]>([]);
  const [loading, setLoading]       = useState(false);
  const [open, setOpen]             = useState(false);
  const debounceRef                 = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef                = useRef<HTMLDivElement>(null);

  const selectedIds = useMemo(() => new Set(selected.map((p) => p.id)), [selected]);

  // Load all products on mount (empty search)
  useEffect(() => {
    fetchProducts('');
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const fetchProducts = (search: string) => {
    setLoading(true);
    api(`/api/meta/catalog-products?search=${encodeURIComponent(search)}`)
      .then((res) => { if (res.success) setResults(res.data); })
      .finally(() => setLoading(false));
  };

  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    setOpen(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchProducts(val), 300);
  };

  const toggle = (product: CatalogProduct) => {
    if (selectedIds.has(product.id)) {
      onChange(selected.filter((p) => p.id !== product.id));
    } else {
      onChange([...selected, product]);
    }
  };

  const remove = (id: string) => onChange(selected.filter((p) => p.id !== id));

  const visibleResults = results.filter((p) => !selectedIds.has(p.id)).slice(0, 30);

  return (
    <div ref={containerRef} className="relative">
      {/* Selected chips */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selected.map((p) => (
            <div key={p.id} className="flex items-center gap-1.5 bg-purple-100 text-purple-800 text-xs font-medium px-2 py-1 rounded-full">
              {p.image_url && <img src={p.image_url} alt="" className="w-4 h-4 rounded-full object-cover" />}
              <span className="max-w-[140px] truncate">{p.name}</span>
              <button onClick={() => remove(p.id)} className="text-purple-500 hover:text-purple-800 ml-0.5">
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
          <button onClick={() => onChange([])} className="text-xs text-gray-400 hover:text-red-500 px-1">
            Clear all
          </button>
        </div>
      )}

      {/* Search input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={handleQueryChange}
          onFocus={() => setOpen(true)}
          placeholder="Search products…"
          className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
        />
        {loading && <RefreshCw className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 animate-spin" />}
      </div>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-64 overflow-y-auto">
          {visibleResults.length === 0 ? (
            <p className="text-xs text-gray-500 px-4 py-3">{loading ? 'Searching…' : 'No products found'}</p>
          ) : (
            visibleResults.map((p) => (
              <button
                key={p.id}
                onClick={() => { toggle(p); setQuery(''); }}
                className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-purple-50 transition-colors text-left"
              >
                {p.image_url ? (
                  <img src={p.image_url} alt={p.name} className="w-9 h-9 rounded-lg object-cover shrink-0 border border-gray-100" />
                ) : (
                  <div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                    <ImageIcon className="w-4 h-4 text-gray-400" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 truncate">{p.name}</p>
                  {p.description && <p className="text-xs text-gray-400 truncate">{p.description}</p>}
                </div>
                {p.price > 0 && <span className="text-xs text-gray-500 shrink-0">{fmt(p.price)}</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ─── Destination URL inline editor ───────────────────────────────────────────

function DestinationUrlField({ value, onSave }: { value: string; onSave: (url: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState(value);

  useEffect(() => { setDraft(value); }, [value]);

  if (!editing) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="font-medium text-gray-500">Shop Now link:</span>
        {value
          ? <a href={value} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline truncate max-w-xs">{value}</a>
          : <span className="text-amber-600 font-medium">⚠ Not set — ad will link to homepage</span>
        }
        <button onClick={() => setEditing(true)} className="text-gray-400 hover:text-blue-600 underline ml-1">Edit</button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="url"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="https://julinemart.com/product/slug"
        className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        autoFocus
      />
      <button
        onClick={() => { onSave(draft); setEditing(false); }}
        className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-blue-700"
      >Save</button>
      <button
        onClick={() => { setDraft(value); setEditing(false); }}
        className="text-gray-500 px-2 py-1.5 rounded-lg text-xs hover:bg-gray-100"
      >Cancel</button>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function MetaAdsPage() {
  const [tab, setTab]                   = useState<'campaigns' | 'drafts' | 'generate'>('campaigns');
  const [campaigns, setCampaigns]       = useState<Campaign[]>([]);
  const [drafts, setDrafts]             = useState<Draft[]>([]);
  const [context, setContext]           = useState<AdsContext | null>(null);
  const [variations, setVariations]     = useState<AiVariation[]>([]);
  const [variationImages, setVariationImages] = useState<string[]>([]);
  const [previewIdx, setPreviewIdx]     = useState<number | null>(null);
  const [loading, setLoading]           = useState(false);
  const [syncing, setSyncing]           = useState(false);
  const [generating, setGenerating]     = useState(false);
  const [error, setError]               = useState('');
  const [expandedDraft, setExpandedDraft] = useState<string | null>(null);
  const [rejectNote, setRejectNote]     = useState('');
  const [rejectingId, setRejectingId]   = useState<string | null>(null);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [publishCampaign, setPublishCampaign]         = useState('');
  const [publishCampaignName, setPublishCampaignName] = useState('');
  const [publishBudget, setPublishBudget]             = useState('');
  const [publishing, setPublishing]                   = useState(false);
  const [deletingId, setDeletingId]                   = useState<string | null>(null);

  // AI generate form
  const [genObjective, setGenObjective] = useState('sales');
  const [genTone, setGenTone]           = useState('engaging');
  const [genCount, setGenCount]         = useState(3);
  const [selectedProducts, setSelectedProducts] = useState<CatalogProduct[]>([]);
  const [destinationUrl, setDestinationUrl]     = useState('');

  const loadCampaigns = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api('/api/meta/campaigns');
      if (res.success) setCampaigns(res.data);
      else setError(res.error || 'Failed to load campaigns');
    } catch { setError('Network error'); }
    finally { setLoading(false); }
  }, []);

  const loadDrafts = useCallback(async () => {
    const res = await api('/api/meta/drafts');
    if (res.success) setDrafts(res.data);
  }, []);

  const loadContext = useCallback(async () => {
    const res = await api('/api/meta/context');
    if (res.success) setContext(res.data);
  }, []);

  useEffect(() => {
    loadCampaigns();
    loadDrafts();
    loadContext();
  }, [loadCampaigns, loadDrafts, loadContext]);

  const handleSync = async () => {
    setSyncing(true);
    setError('');
    try {
      const res = await api('/api/meta/campaigns/sync', { method: 'POST' });
      if (res.success) { await loadCampaigns(); }
      else setError(res.error || 'Sync failed');
    } catch { setError('Sync failed'); }
    finally { setSyncing(false); }
  };

  const handleStatusChange = async (metaId: string, status: 'ACTIVE' | 'PAUSED') => {
    try {
      await api(`/api/meta/campaigns/${metaId}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status }),
      });
      setCampaigns((prev) => prev.map((c) => c.meta_campaign_id === metaId ? { ...c, status } : c));
    } catch { setError('Failed to update campaign status'); }
  };

  // Auto-populate destination URL from the first selected product
  useEffect(() => {
    const url = selectedProducts[0]?.product_url || '';
    if (url) setDestinationUrl(url);
  }, [selectedProducts]);

  const handleGenerate = async () => {
    setGenerating(true);
    setVariations([]);
    setVariationImages([]);
    setPreviewIdx(null);
    setError('');
    try {
      const defaultImage = selectedProducts[0]?.image_url || '';

      const res = await api('/api/meta/ai/generate', {
        method: 'POST',
        body: JSON.stringify({
          products:    selectedProducts,
          top_region:  context?.top_region,
          promo_code:  context?.active_promos[0]?.code,
          objective:   genObjective,
          tone:        genTone,
          count:       genCount,
        }),
      });
      if (res.success) {
        setVariations(res.data);
        setVariationImages(new Array(res.data.length).fill(defaultImage));
        setPreviewIdx(0);
      } else setError(res.error || 'Generation failed');
    } catch { setError('Generation failed'); }
    finally { setGenerating(false); }
  };

  const saveDraft = async (v: AiVariation, imageUrl: string) => {
    const res = await api('/api/meta/drafts', {
      method: 'POST',
      body: JSON.stringify({
        title:           v.headline || v.body_text.slice(0, 50),
        headline:        v.headline,
        body_text:       v.body_text,
        call_to_action:  v.call_to_action,
        image_url:       imageUrl || null,
        destination_url: destinationUrl.trim() || null,
        ai_generated:    true,
        source_products: selectedProducts,
        source_context:  { top_region: context?.top_region, promo: context?.active_promos[0] },
      }),
    });
    if (res.success) { await loadDrafts(); setTab('drafts'); }
  };

  const handleUpdateDestinationUrl = async (draftId: string, url: string) => {
    await api(`/api/meta/drafts/${draftId}`, {
      method: 'PUT',
      body: JSON.stringify({ destination_url: url.trim() || null }),
    });
    await loadDrafts();
  };

  const handleApprove = async (id: string) => {
    const res = await api(`/api/meta/drafts/${id}/approve`, { method: 'PUT' });
    if (res.success) loadDrafts();
  };

  const handleReject = async (id: string) => {
    const res = await api(`/api/meta/drafts/${id}/reject`, {
      method: 'PUT',
      body: JSON.stringify({ note: rejectNote }),
    });
    if (res.success) { setRejectingId(null); setRejectNote(''); loadDrafts(); }
  };

  const handleDeleteDraft = async (id: string, title: string, published: boolean) => {
    const extra = published
      ? ' This only removes the record in JulineMart. The ad may still exist in Meta Ads Manager — delete or pause it there if needed.'
      : '';
    if (!window.confirm(`Delete “${title}”?${extra}`)) return;
    setDeletingId(id);
    setError('');
    try {
      const res = await api(`/api/meta/drafts/${id}`, { method: 'DELETE' });
      if (res.success) {
        if (expandedDraft === id) setExpandedDraft(null);
        if (publishingId === id) setPublishingId(null);
        loadDrafts();
      } else setError(res.error || 'Delete failed');
    } catch {
      setError('Delete failed');
    } finally {
      setDeletingId(null);
    }
  };

  const handlePublish = async (id: string) => {
    const hasExisting = campaigns.filter((c) => c.status === 'ACTIVE' || c.status === 'PAUSED').length > 0;
    if (hasExisting && !publishCampaign) { setError('Select a campaign first'); return; }
    if (!hasExisting && !publishCampaignName.trim()) { setError('Enter a campaign name'); return; }
    if (!publishBudget || Number(publishBudget) < META_PUBLISH_MIN_DAILY_BUDGET_NGN) {
      setError(`Enter a daily budget of at least ₦${META_PUBLISH_MIN_DAILY_BUDGET_NGN.toLocaleString()} per Meta`);
      return;
    }
    setPublishing(true);
    setError('');
    try {
      const payload: Record<string, unknown> = { daily_budget: Number(publishBudget) };
      if (publishCampaign) payload.campaign_id = publishCampaign;
      else payload.new_campaign_name = publishCampaignName.trim();
      const res = await api(`/api/meta/drafts/${id}/publish`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (res.success) {
        setPublishingId(null);
        setPublishCampaign(‘’);
        setPublishCampaignName(‘’);
        setPublishBudget(‘’);
        loadDrafts();
        // Sync Meta campaigns so the new campaign/ad appears immediately in the Campaigns tab
        const syncRes = await api(‘/api/meta/campaigns/sync’, { method: ‘POST’ });
        await loadCampaigns();
        setTab(‘campaigns’); // Take the user to Campaigns tab to see the result
        if (!syncRes?.success && syncRes?.error) {
          setError(
            `Published! But campaign list didn’t refresh: ${syncRes.error}. Click Sync Campaigns.`
          );
        }
      } else setError(res.error || ‘Publish failed’);
    } catch { setError('Publish failed'); }
    finally { setPublishing(false); }
  };

  // Aggregate stats
  const totals = campaigns.reduce(
    (acc, c) => ({
      spend:       acc.spend + Number(c.spend || 0),
      impressions: acc.impressions + Number(c.impressions || 0),
      clicks:      acc.clicks + Number(c.clicks || 0),
      reach:       acc.reach + Number(c.reach || 0),
    }),
    { spend: 0, impressions: 0, clicks: 0, reach: 0 }
  );
  const avgCtr = totals.impressions > 0 ? ((totals.clicks / totals.impressions) * 100).toFixed(2) : '0.00';
  const alertCampaigns = campaigns.filter(isAlertCampaign);
  const pendingDrafts  = drafts.filter((d) => d.status === 'draft').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center">
            <Megaphone className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Meta Ads</h1>
            <p className="text-sm text-gray-500">Campaigns, AI content & draft management</p>
          </div>
        </div>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Syncing…' : 'Sync Campaigns'}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Performance alert banner */}
      {alertCampaigns.length > 0 && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-800">
              {alertCampaigns.length} campaign{alertCampaigns.length > 1 ? 's' : ''} with low CTR
            </p>
            <p className="text-xs text-amber-700 mt-0.5">
              {alertCampaigns.map((c) => c.name).join(', ')} — spending but CTR below 1%. Consider pausing or refreshing creative.
            </p>
          </div>
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={DollarSign}    label="Total Spend"  value={fmt(totals.spend)}          color="bg-blue-50 text-blue-600" />
        <StatCard icon={Eye}           label="Impressions"  value={fmtNum(totals.impressions)}  color="bg-purple-50 text-purple-600" />
        <StatCard icon={MousePointer}  label="Clicks"       value={fmtNum(totals.clicks)}       sub={`${avgCtr}% CTR`} color="bg-green-50 text-green-600" />
        <StatCard icon={Users}         label="Reach"        value={fmtNum(totals.reach)}        color="bg-orange-50 text-orange-600" />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        {(['campaigns', 'drafts', 'generate'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors capitalize ${
              tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {t === 'generate' ? 'AI Generate' : t}
            {t === 'campaigns' && alertCampaigns.length > 0 && (
              <span className="ml-2 bg-amber-100 text-amber-700 text-xs px-1.5 py-0.5 rounded-full">
                {alertCampaigns.length}
              </span>
            )}
            {t === 'drafts' && pendingDrafts > 0 && (
              <span className="ml-2 bg-blue-100 text-blue-700 text-xs px-1.5 py-0.5 rounded-full">
                {pendingDrafts}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Campaigns tab ────────────────────────────────────────────────────── */}
      {tab === 'campaigns' && (
        <>
          {loading ? (
            <div className="bg-white rounded-xl border border-gray-200 py-12 text-center text-gray-500 text-sm">
              Loading campaigns…
            </div>
          ) : campaigns.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 py-12 text-center text-gray-500 text-sm">
              No campaigns cached. Click <strong>Sync Campaigns</strong> to fetch from Meta.
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {campaigns.map((c) => (
                <CampaignCard key={c.id} campaign={c} onStatusChange={handleStatusChange} />
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Drafts tab ───────────────────────────────────────────────────────── */}
      {tab === 'drafts' && (
        <div className="space-y-3">
          {drafts.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 py-12 text-center text-gray-500 text-sm">
              No drafts yet. Use <strong>AI Generate</strong> to create content.
            </div>
          ) : (
            drafts.map((d) => (
              <div key={d.id} className="bg-white rounded-xl border border-gray-200">
                <div
                  className="flex items-center justify-between px-5 py-4 cursor-pointer"
                  onClick={() => setExpandedDraft(expandedDraft === d.id ? null : d.id)}
                >
                  <div className="flex items-center gap-3">
                    {d.ai_generated && <Sparkles className="w-4 h-4 text-purple-500" />}
                    <div>
                      <p className="font-medium text-gray-900 text-sm">{d.title}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {new Date(d.created_at).toLocaleDateString()} · {d.call_to_action}
                        {d.users && ` · ${d.users.full_name}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLOR[d.status] || 'bg-gray-100'}`}>
                      {d.status}
                    </span>
                    <button
                      type="button"
                      title="Delete draft"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteDraft(d.id, d.title, d.status === 'published');
                      }}
                      disabled={deletingId === d.id || publishingId === d.id}
                      className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-40 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    {expandedDraft === d.id ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                  </div>
                </div>

                {expandedDraft === d.id && (
                  <div className="border-t border-gray-100 px-5 py-4 space-y-4">
                    <div className="grid lg:grid-cols-2 gap-5">
                      <div className="space-y-3">
                        {d.headline && <p className="font-semibold text-gray-900">{d.headline}</p>}
                        <p className="text-gray-700 text-sm leading-relaxed">{d.body_text}</p>
                      </div>
                      <FbAdPreview
                        headline={d.headline}
                        body={d.body_text}
                        cta={d.call_to_action}
                        imageUrl={d.image_url || ''}
                      />
                    </div>

                    {/* Destination URL — editable on non-published drafts */}
                    {d.status !== 'published' ? (
                      <DestinationUrlField
                        value={d.destination_url || ''}
                        onSave={(url) => handleUpdateDestinationUrl(d.id, url)}
                      />
                    ) : d.destination_url ? (
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <span className="font-medium">Shop Now link:</span>
                        <a href={d.destination_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline truncate">{d.destination_url}</a>
                      </div>
                    ) : null}

                    {d.status === 'draft' && (
                      <div className="flex flex-col gap-3">
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleApprove(d.id)}
                            className="flex items-center gap-1.5 bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 transition-colors"
                          >
                            <CheckCircle className="w-4 h-4" /> Approve
                          </button>
                          <button
                            onClick={() => setRejectingId(rejectingId === d.id ? null : d.id)}
                            className="flex items-center gap-1.5 border border-red-200 text-red-600 px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-50 transition-colors"
                          >
                            <XCircle className="w-4 h-4" /> Reject
                          </button>
                        </div>
                        {rejectingId === d.id && (
                          <div className="flex gap-2">
                            <input
                              value={rejectNote}
                              onChange={(e) => setRejectNote(e.target.value)}
                              placeholder="Rejection reason (optional)"
                              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                            <button
                              onClick={() => handleReject(d.id)}
                              className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-700 transition-colors"
                            >
                              Confirm
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {d.status === 'approved' && (
                      <div className="space-y-3">
                        {publishingId !== d.id ? (
                          <button
                            onClick={() => { setPublishingId(d.id); setPublishCampaign(''); setPublishCampaignName(''); setPublishBudget(String(d.suggested_budget || '')); }}
                            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                          >
                            <Send className="w-4 h-4" /> Publish to Meta
                          </button>
                        ) : (
                          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-3">
                            <p className="text-sm font-semibold text-blue-900">Publish to Meta Ads</p>
                            <div>
                              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Campaign</label>
                              {campaigns.filter((c) => c.status === 'ACTIVE' || c.status === 'PAUSED').length > 0 ? (
                                <select
                                  value={publishCampaign}
                                  onChange={(e) => setPublishCampaign(e.target.value)}
                                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                >
                                  <option value="">Select a campaign…</option>
                                  {campaigns.filter((c) => c.status === 'ACTIVE' || c.status === 'PAUSED').map((c) => (
                                    <option key={c.meta_campaign_id} value={c.meta_campaign_id}>{c.name}</option>
                                  ))}
                                </select>
                              ) : (
                                <input
                                  type="text"
                                  value={publishCampaignName}
                                  onChange={(e) => setPublishCampaignName(e.target.value)}
                                  placeholder="e.g. JulineMart May Sales"
                                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                              )}
                              <p className="text-xs text-gray-400 mt-1">
                                {campaigns.filter((c) => c.status === 'ACTIVE' || c.status === 'PAUSED').length > 0
                                  ? 'Select an existing campaign'
                                  : 'No campaigns yet — a new one will be created automatically'}
                              </p>
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Daily Budget (₦)</label>
                              <input
                                type="number"
                                min={META_PUBLISH_MIN_DAILY_BUDGET_NGN}
                                value={publishBudget}
                                onChange={(e) => setPublishBudget(e.target.value)}
                                placeholder="e.g. 5000"
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                              <p className="text-xs text-gray-400 mt-1">
                                Minimum ₦{META_PUBLISH_MIN_DAILY_BUDGET_NGN.toLocaleString()} (Meta account minimum varies by optimisation)
                              </p>
                            </div>
                            <p className="text-xs text-gray-500">Ad will be created as <strong>PAUSED</strong> — activate it in Meta Ads Manager after review.</p>
                            <div className="flex gap-2">
                              <button
                                onClick={() => handlePublish(d.id)}
                                disabled={publishing}
                                className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60 transition-colors"
                              >
                                <Send className={`w-4 h-4 ${publishing ? 'animate-pulse' : ''}`} />
                                {publishing ? 'Publishing…' : 'Confirm Publish'}
                              </button>
                              <button
                                onClick={() => setPublishingId(null)}
                                className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {d.status === 'published' && (
                      <div className="flex items-center gap-2 text-blue-700 bg-blue-50 rounded-lg px-3 py-2 text-sm">
                        <Send className="w-4 h-4" />
                        Published to Meta{d.published_at ? ` · ${new Date(d.published_at).toLocaleDateString()}` : ''}{d.meta_ad_id ? ` · Ad ID: ${d.meta_ad_id}` : ''}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* ── AI Generate tab ──────────────────────────────────────────────────── */}
      {tab === 'generate' && (
        <div className="space-y-6">
          <div className="grid lg:grid-cols-2 gap-6">
            {/* Controls */}
            <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-5">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-purple-600" />
                <h2 className="font-semibold text-gray-900">Generate Ad Content</h2>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  Select Products
                </label>
                <ProductSearchCombobox
                  selected={selectedProducts}
                  onChange={setSelectedProducts}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                  Shop Now Link (Destination URL)
                </label>
                <input
                  type="url"
                  value={destinationUrl}
                  onChange={(e) => setDestinationUrl(e.target.value)}
                  placeholder="https://julinemart.com/product/product-slug"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-400 mt-1">
                  {selectedProducts[0]?.product_url
                    ? 'Auto-filled from selected product — edit if needed'
                    : 'Where the "Shop Now" button takes customers'}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Objective</label>
                  <select
                    value={genObjective}
                    onChange={(e) => setGenObjective(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="sales">Sales</option>
                    <option value="awareness">Awareness</option>
                    <option value="traffic">Traffic</option>
                    <option value="leads">Leads</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Tone</label>
                  <select
                    value={genTone}
                    onChange={(e) => setGenTone(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="engaging">Engaging</option>
                    <option value="urgent">Urgent</option>
                    <option value="friendly">Friendly</option>
                    <option value="bold">Bold</option>
                    <option value="professional">Professional</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                  Number of Variations
                </label>
                <input
                  type="number" min={1} max={5} value={genCount}
                  onChange={(e) => setGenCount(Number(e.target.value))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {context?.top_region && (
                <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
                  Top buying region: <strong>{context.top_region}</strong>
                </p>
              )}
              {context?.active_promos[0] && (
                <p className="text-xs text-gray-500 bg-blue-50 rounded-lg px-3 py-2">
                  Active promo: <strong>{context.active_promos[0].code}</strong>
                </p>
              )}

              <button
                onClick={handleGenerate}
                disabled={generating}
                className="w-full flex items-center justify-center gap-2 bg-purple-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-60 transition-colors"
              >
                <Sparkles className={`w-4 h-4 ${generating ? 'animate-pulse' : ''}`} />
                {generating ? 'Generating…' : 'Generate with AI'}
              </button>
            </div>

            {/* FB Preview panel */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-gray-700">Preview</h3>
              {variations.length > 0 && previewIdx !== null ? (
                <>
                  <div className="flex gap-2 flex-wrap">
                    {variations.map((_, i) => (
                      <button
                        key={i}
                        onClick={() => setPreviewIdx(i)}
                        className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${previewIdx === i ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                      >
                        Var {i + 1}
                      </button>
                    ))}
                  </div>
                  <FbAdPreview
                    headline={variations[previewIdx].headline}
                    body={variations[previewIdx].body_text}
                    cta={variations[previewIdx].call_to_action}
                    imageUrl={variationImages[previewIdx]}
                  />
                </>
              ) : (
                <div className="bg-gray-50 rounded-xl border border-gray-200 py-12 text-center text-gray-500 text-sm">
                  {generating ? (
                    <>
                      <Sparkles className="w-8 h-8 text-purple-400 mx-auto animate-pulse mb-3" />
                      <p className="text-purple-700 font-medium">Generating with your JulineMart data…</p>
                    </>
                  ) : (
                    'Generate variations to see a Facebook preview'
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Variations list */}
          {variations.length > 0 && (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-gray-700">Variations</h3>
              {variations.map((v, i) => (
                <div
                  key={i}
                  className={`bg-white rounded-xl border p-5 space-y-4 cursor-pointer transition-all ${previewIdx === i ? 'border-purple-300 ring-1 ring-purple-200' : 'border-gray-200 hover:border-gray-300'}`}
                  onClick={() => setPreviewIdx(i)}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-purple-600 uppercase tracking-wide flex items-center gap-1">
                      <Sparkles className="w-3.5 h-3.5" /> Variation {i + 1}
                    </span>
                    <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">{v.call_to_action}</span>
                  </div>
                  <p className="font-semibold text-gray-900">{v.headline}</p>
                  <p className="text-gray-700 text-sm leading-relaxed">{v.body_text}</p>

                  {/* Per-variation image picker */}
                  <div onClick={(e) => e.stopPropagation()}>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Ad Image</p>
                    <ImagePicker
                      value={variationImages[i] || ''}
                      onChange={(url) =>
                        setVariationImages((prev) => {
                          const next = [...prev];
                          next[i] = url;
                          return next;
                        })
                      }
                    />
                  </div>

                  <button
                    onClick={(e) => { e.stopPropagation(); saveDraft(v, variationImages[i] || ''); }}
                    className="flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors"
                  >
                    <Plus className="w-4 h-4" /> Save as Draft
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
