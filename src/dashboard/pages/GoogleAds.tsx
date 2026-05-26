import { useEffect, useState, useCallback, useRef } from 'react';
import {
  TrendingUp, RefreshCw, Sparkles, CheckCircle, XCircle,
  Clock, Eye, MousePointer, DollarSign, Target, Plus,
  ChevronDown, ChevronUp, AlertCircle, Megaphone, AlertTriangle,
  Play, Pause, Send, Trash2, Wand2, FileText, Globe, Search,
  BarChart2, Zap, Building2, ShoppingBag, GraduationCap, Pencil, X as XIcon,
  Image as ImageIcon2, Video, Link,
} from 'lucide-react';

const apiBase = (import.meta as any).env?.VITE_API_BASE_URL || '';
const api = (path: string, opts?: RequestInit) =>
  fetch(`${apiBase}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${localStorage.getItem('sb-access-token') || ''}`,
    },
    ...opts,
  }).then((r) => r.json());

const GOOGLE_PUBLISH_MIN_DAILY_BUDGET_NGN = 1000;

// ─── Types ─────────────────────────────────────────────────────────────────────

type AccountKey = 'julinemart' | 'services' | 'skolahq';

interface AccountInfo {
  key: AccountKey;
  name: string;
  icon: React.ElementType;
  color: string;
  bg: string;
  website: string;
  description: string;
}

const ACCOUNTS: AccountInfo[] = [
  {
    key: 'julinemart',
    name: 'JulineMart Nigeria',
    icon: ShoppingBag,
    color: 'text-blue-600',
    bg: 'bg-blue-600',
    website: 'julinemart.com',
    description: 'E-commerce',
  },
  {
    key: 'services',
    name: 'JulineServices',
    icon: Zap,
    color: 'text-green-600',
    bg: 'bg-green-600',
    website: 'services.julinemart.com',
    description: 'Service Marketplace',
  },
  {
    key: 'skolahq',
    name: 'SkolaHQ',
    icon: GraduationCap,
    color: 'text-purple-600',
    bg: 'bg-purple-600',
    website: 'skolahq.com',
    description: 'School Management SaaS',
  },
];

interface GoogleCampaign {
  id: string;
  google_campaign_id: string;
  account_key: AccountKey;
  account_name: string;
  name: string;
  status: string;           // ENABLED | PAUSED | REMOVED
  campaign_type: string;    // SEARCH | DISPLAY | VIDEO | PERFORMANCE_MAX
  budget_amount_micros: number;
  impressions: number;
  clicks: number;
  cost_micros: number;
  conversions: number;
  ctr: number;
  average_cpc_micros: number;
  synced_at: string;
}

interface GoogleDraft {
  id: string;
  account_key: AccountKey;
  title: string;
  headlines: string[];
  descriptions: string[];
  final_url: string | null;
  image_url: string | null;
  image_url_square: string | null;
  video_url: string | null;
  logo_url: string | null;
  long_headline: string | null;
  campaign_type: string;
  call_to_action: string;
  status: string;           // draft | approved | rejected | published
  ai_generated: boolean;
  suggested_budget_ngn: number | null;
  google_campaign_id: string | null;
  google_ad_id: string | null;
  rejection_note: string | null;
  published_at: string | null;
  created_at: string;
  users?: { full_name: string; email: string };
}

interface RsaVariation {
  headlines: string[];
  descriptions: string[];
  call_to_action: string;
  suggested_budget_ngn?: number;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

const fmt    = (n: number) => `₦${Number(n || 0).toLocaleString()}`;
const fmtNum = (n: number) => Number(n || 0).toLocaleString();
const microToNgn = (micros: number) => micros / 1_000_000;
const fmtMicros  = (micros: number) => fmt(microToNgn(micros));

const CAMPAIGN_STATUS_COLOR: Record<string, string> = {
  ENABLED:  'bg-green-100 text-green-800',
  PAUSED:   'bg-yellow-100 text-yellow-800',
  REMOVED:  'bg-red-100 text-red-700',
};
const DRAFT_STATUS_COLOR: Record<string, string> = {
  draft:     'bg-gray-100 text-gray-700',
  approved:  'bg-green-100 text-green-800',
  rejected:  'bg-red-100 text-red-700',
  published: 'bg-blue-100 text-blue-800',
};

const CAMPAIGN_TYPE_LABEL: Record<string, string> = {
  SEARCH:          'Search',
  DISPLAY:         'Display',
  VIDEO:           'Video',
  PERFORMANCE_MAX: 'Pmax',
};

const CAMPAIGN_TYPE_COLOR: Record<string, string> = {
  SEARCH:          'bg-blue-100 text-blue-800',
  DISPLAY:         'bg-purple-100 text-purple-800',
  VIDEO:           'bg-red-100 text-red-800',
  PERFORMANCE_MAX: 'bg-orange-100 text-orange-800',
};

function isAlertCampaign(c: GoogleCampaign) {
  return microToNgn(c.cost_micros) > 0 && Number(c.ctr) < 1.0;
}

// ─── Stat card ─────────────────────────────────────────────────────────────────

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

// ─── Campaign card ─────────────────────────────────────────────────────────────

function CampaignCard({ campaign, onStatusChange, onBudgetChange }: {
  campaign: GoogleCampaign;
  onStatusChange: (googleId: string, status: 'ENABLED' | 'PAUSED') => void;
  onBudgetChange: (googleId: string, budgetNgn: number) => Promise<void>;
}) {
  const alert = isAlertCampaign(campaign);
  const budgetNgn = microToNgn(campaign.budget_amount_micros || 0);
  const spentNgn  = microToNgn(campaign.cost_micros || 0);
  const spendPct  = budgetNgn > 0 ? Math.min(100, (spentNgn / budgetNgn) * 100) : 0;
  const [toggling, setToggling]           = useState(false);
  const [editingBudget, setEditingBudget] = useState(false);
  const [budgetInput, setBudgetInput]     = useState('');
  const [savingBudget, setSavingBudget]   = useState(false);

  const handleToggle = async () => {
    setToggling(true);
    const next = campaign.status === 'ENABLED' ? 'PAUSED' : 'ENABLED';
    await onStatusChange(campaign.google_campaign_id, next);
    setToggling(false);
  };

  const handleBudgetEdit = () => {
    setBudgetInput(String(Math.round(budgetNgn || 0)));
    setEditingBudget(true);
  };

  const handleBudgetSave = async () => {
    setSavingBudget(true);
    await onBudgetChange(campaign.google_campaign_id, Number(budgetInput));
    setSavingBudget(false);
    setEditingBudget(false);
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
          {campaign.campaign_type && (
            <span className="inline-block text-xs text-gray-500 mt-0.5 uppercase tracking-wide">
              {CAMPAIGN_TYPE_LABEL[campaign.campaign_type] || campaign.campaign_type}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-xs px-2 py-1 rounded-full font-medium ${CAMPAIGN_STATUS_COLOR[campaign.status] || 'bg-gray-100 text-gray-700'}`}>
            {campaign.status}
          </span>
          {(campaign.status === 'ENABLED' || campaign.status === 'PAUSED') && (
            <button
              onClick={handleToggle}
              disabled={toggling}
              title={campaign.status === 'ENABLED' ? 'Pause campaign' : 'Enable campaign'}
              className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors disabled:opacity-50 ${
                campaign.status === 'ENABLED'
                  ? 'bg-yellow-50 text-yellow-600 hover:bg-yellow-100'
                  : 'bg-green-50 text-green-600 hover:bg-green-100'
              }`}
            >
              {toggling
                ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                : campaign.status === 'ENABLED'
                  ? <Pause className="w-3.5 h-3.5" />
                  : <Play className="w-3.5 h-3.5" />
              }
            </button>
          )}
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-4 gap-2 text-center">
        <div className="bg-gray-50 rounded-lg py-2.5 px-1">
          <p className="text-xs text-gray-400 mb-0.5">Spend</p>
          <p className="text-sm font-bold text-gray-900">{fmtMicros(campaign.cost_micros)}</p>
        </div>
        <div className="bg-gray-50 rounded-lg py-2.5 px-1">
          <p className="text-xs text-gray-400 mb-0.5">Impressions</p>
          <p className="text-sm font-bold text-gray-900">{fmtNum(campaign.impressions)}</p>
        </div>
        <div className="bg-gray-50 rounded-lg py-2.5 px-1">
          <p className="text-xs text-gray-400 mb-0.5">Clicks</p>
          <p className="text-sm font-bold text-gray-900">{fmtNum(campaign.clicks)}</p>
        </div>
        <div className={`rounded-lg py-2.5 px-1 ${alert ? 'bg-amber-50' : 'bg-gray-50'}`}>
          <p className="text-xs text-gray-400 mb-0.5">CTR</p>
          <p className={`text-sm font-bold ${alert ? 'text-amber-600' : 'text-gray-900'}`}>
            {Number(campaign.ctr || 0).toFixed(2)}%
          </p>
        </div>
      </div>

      {/* Conversions + CPC row */}
      <div className="flex items-center justify-between text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <Target className="w-3 h-3" />
          <span className="font-medium text-gray-700">{Number(campaign.conversions || 0).toFixed(1)}</span> conversions
        </span>
        {campaign.average_cpc_micros > 0 && (
          <span>Avg CPC: <span className="font-medium text-gray-700">{fmtMicros(campaign.average_cpc_micros)}</span></span>
        )}
      </div>

      {/* Budget bar + inline editor */}
      {budgetNgn > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>Daily budget</span>
            {!editingBudget ? (
              <div className="flex items-center gap-1.5">
                <span>{fmtMicros(campaign.cost_micros)} / {fmt(budgetNgn)}</span>
                <button
                  onClick={handleBudgetEdit}
                  title="Adjust budget"
                  className="text-gray-400 hover:text-blue-600 transition-colors"
                >
                  <Pencil className="w-3 h-3" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <span className="text-gray-400">₦</span>
                <input
                  type="number"
                  value={budgetInput}
                  onChange={(e) => setBudgetInput(e.target.value)}
                  className="w-24 border border-blue-300 rounded px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 text-gray-900"
                  autoFocus
                  onKeyDown={(e) => { if (e.key === 'Enter') handleBudgetSave(); if (e.key === 'Escape') setEditingBudget(false); }}
                />
                <button
                  onClick={handleBudgetSave}
                  disabled={savingBudget}
                  className="text-xs bg-blue-600 text-white px-2 py-0.5 rounded hover:bg-blue-700 disabled:opacity-50"
                >
                  {savingBudget ? '…' : 'Save'}
                </button>
                <button onClick={() => setEditingBudget(false)} className="text-gray-400 hover:text-gray-600">
                  <XIcon className="w-3 h-3" />
                </button>
              </div>
            )}
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
          Low CTR with active spend — review keywords or ad copy
        </p>
      )}
    </div>
  );
}

// ─── Google Search Ad Preview ───────────────────────────────────────────────────

function GoogleAdPreview({ headlines, descriptions, displayUrl, account }: {
  headlines: string[];
  descriptions: string[];
  displayUrl: string;
  account: AccountInfo;
}) {
  // Google rotates headlines — show first 3 as a sample
  const h1 = headlines[0] || 'Headline 1';
  const h2 = headlines[1] || 'Headline 2';
  const h3 = headlines[2] || 'Headline 3';
  const d1 = descriptions[0] || 'Description line 1 will appear here.';
  const d2 = descriptions[1] || 'Description line 2 will appear here.';

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 max-w-lg">
      <p className="text-xs text-gray-400 mb-3 flex items-center gap-1">
        <Search className="w-3 h-3" /> Google Search Preview
      </p>
      {/* Ad label + URL */}
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs border border-gray-400 text-gray-600 px-1.5 py-0.5 rounded font-medium leading-none">Ad</span>
        <span className="text-xs text-gray-600">{displayUrl}</span>
      </div>
      {/* Headline */}
      <p className="text-blue-700 text-lg font-medium leading-snug hover:underline cursor-pointer">
        {h1} | {h2} | {h3}
      </p>
      {/* Descriptions */}
      <p className="text-sm text-gray-700 mt-1.5 leading-relaxed">
        {d1} {d2}
      </p>
      <p className="text-xs text-gray-400 mt-3 border-t border-gray-100 pt-2">
        Google rotates up to {headlines.length} headlines & {descriptions.length} descriptions to find the best combination
      </p>
    </div>
  );
}

// ─── RSA Headlines / Descriptions editor ────────────────────────────────────────

function RsaEditor({ headlines, descriptions, onChangeHeadlines, onChangeDescriptions,
  maxHeadlines = 15, headlineLabel = 'Headlines', headlineHint, descriptionLabel = 'Descriptions', descriptionHint,
}: {
  headlines: string[];
  descriptions: string[];
  onChangeHeadlines: (v: string[]) => void;
  onChangeDescriptions: (v: string[]) => void;
  maxHeadlines?: number;
  headlineLabel?: string;
  headlineHint?: string;
  descriptionLabel?: string;
  descriptionHint?: string;
}) {
  const maxDesc = maxHeadlines === 5 ? 5 : 4; // Display allows 5 descriptions
  const addHeadline = () => {
    if (headlines.length < maxHeadlines) onChangeHeadlines([...headlines, '']);
  };
  const addDescription = () => {
    if (descriptions.length < maxDesc) onChangeDescriptions([...descriptions, '']);
  };

  return (
    <div className="space-y-4">
      {/* Headlines */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            {headlineLabel} <span className="font-normal text-gray-400">{headlineHint || `(${headlines.length}/${maxHeadlines}, max 30 chars each)`}</span>
          </p>
          {headlines.length < maxHeadlines && (
            <button onClick={addHeadline} className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-0.5">
              <Plus className="w-3 h-3" /> Add
            </button>
          )}
        </div>
        <div className="space-y-1.5">
          {headlines.map((h, i) => (
            <div key={i} className="flex gap-1.5 items-center">
              <span className="text-xs text-gray-400 w-5 text-right shrink-0">{i + 1}</span>
              <input
                type="text"
                value={h}
                maxLength={30}
                onChange={(e) => {
                  const next = [...headlines];
                  next[i] = e.target.value;
                  onChangeHeadlines(next);
                }}
                placeholder={`Headline ${i + 1}`}
                className={`flex-1 border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  h.length > 30 ? 'border-red-400' : 'border-gray-300'
                }`}
              />
              <span className={`text-xs w-8 text-right shrink-0 ${h.length > 28 ? 'text-amber-600' : 'text-gray-400'}`}>
                {h.length}
              </span>
              {headlines.length > 3 && (
                <button
                  onClick={() => onChangeHeadlines(headlines.filter((_, idx) => idx !== i))}
                  className="text-gray-300 hover:text-red-500 transition-colors"
                >
                  <XCircle className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Descriptions */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            {descriptionLabel} <span className="font-normal text-gray-400">{descriptionHint || `(${descriptions.length}/${maxDesc}, max 90 chars each)`}</span>
          </p>
          {descriptions.length < maxDesc && (
            <button onClick={addDescription} className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-0.5">
              <Plus className="w-3 h-3" /> Add
            </button>
          )}
        </div>
        <div className="space-y-1.5">
          {descriptions.map((d, i) => (
            <div key={i} className="flex gap-1.5 items-start">
              <span className="text-xs text-gray-400 w-5 text-right shrink-0 mt-2">{i + 1}</span>
              <div className="flex-1">
                <textarea
                  value={d}
                  maxLength={90}
                  rows={2}
                  onChange={(e) => {
                    const next = [...descriptions];
                    next[i] = e.target.value;
                    onChangeDescriptions(next);
                  }}
                  placeholder={`Description ${i + 1}`}
                  className={`w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none ${
                    d.length > 90 ? 'border-red-400' : 'border-gray-300'
                  }`}
                />
                <span className={`text-xs ${d.length > 85 ? 'text-amber-600' : 'text-gray-400'}`}>{d.length}/90</span>
              </div>
              {descriptions.length > 1 && (
                <button
                  onClick={() => onChangeDescriptions(descriptions.filter((_, idx) => idx !== i))}
                  className="text-gray-300 hover:text-red-500 transition-colors mt-2"
                >
                  <XCircle className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export function GoogleAdsPage() {
  const [activeAccount, setActiveAccount] = useState<AccountKey>('julinemart');
  const [tab, setTab]                     = useState<'campaigns' | 'drafts' | 'generate' | 'creator'>('campaigns');
  const [campaigns, setCampaigns]         = useState<GoogleCampaign[]>([]);
  const [drafts, setDrafts]               = useState<GoogleDraft[]>([]);
  const [loading, setLoading]             = useState(false);
  const [syncing, setSyncing]             = useState(false);
  const [error, setError]                 = useState('');

  // Draft management
  const [expandedDraft, setExpandedDraft]     = useState<string | null>(null);
  const [rejectNote, setRejectNote]           = useState('');
  const [rejectingId, setRejectingId]         = useState<string | null>(null);
  const [publishingId, setPublishingId]       = useState<string | null>(null);
  const [publishCampaign, setPublishCampaign] = useState('');
  const [publishCampaignName, setPublishCampaignName] = useState('');
  const [publishBudget, setPublishBudget]     = useState('');
  const [publishing, setPublishing]           = useState(false);
  const [deletingId, setDeletingId]           = useState<string | null>(null);

  // AI Generate form
  const [genObjective, setGenObjective] = useState('sales');
  const [genTone, setGenTone]           = useState('engaging');
  const [genCount, setGenCount]         = useState(3);
  const [genBrief, setGenBrief]         = useState('');
  const [generating, setGenerating]     = useState(false);
  const [variations, setVariations]     = useState<RsaVariation[]>([]);
  const [previewIdx, setPreviewIdx]     = useState<number | null>(null);

  const activeAccountInfo = ACCOUNTS.find((a) => a.key === activeAccount)!;

  // ── Derived: filter by account ─────────────────────────────────────────────

  const accountCampaigns = campaigns.filter((c) => c.account_key === activeAccount);
  const accountDrafts    = drafts.filter((d) => d.account_key === activeAccount);

  // ── Load data ──────────────────────────────────────────────────────────────

  const loadCampaigns = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api(`/api/google/campaigns?account=${activeAccount}`);
      if (res.success) setCampaigns((prev) => {
        const others = prev.filter((c) => c.account_key !== activeAccount);
        return [...others, ...res.data];
      });
      else setError(res.error || 'Failed to load campaigns');
    } catch { setError('Network error'); }
    finally { setLoading(false); }
  }, [activeAccount]);

  const loadDrafts = useCallback(async () => {
    const res = await api(`/api/google/drafts?account=${activeAccount}`);
    if (res.success) setDrafts((prev) => {
      const others = prev.filter((d) => d.account_key !== activeAccount);
      return [...others, ...res.data];
    });
  }, [activeAccount]);

  useEffect(() => {
    loadCampaigns();
    loadDrafts();
    setVariations([]);
    setPreviewIdx(null);
  }, [loadCampaigns, loadDrafts]);

  // ── Sync ───────────────────────────────────────────────────────────────────

  const handleSync = async () => {
    setSyncing(true);
    setError('');
    try {
      const res = await api(`/api/google/campaigns/sync`, {
        method: 'POST',
        body: JSON.stringify({ account: activeAccount }),
      });
      if (res.success) await loadCampaigns();
      else setError(res.error || 'Sync failed');
    } catch { setError('Sync failed'); }
    finally { setSyncing(false); }
  };

  // ── Campaign status toggle ─────────────────────────────────────────────────

  const handleStatusChange = async (googleId: string, status: 'ENABLED' | 'PAUSED') => {
    try {
      await api(`/api/google/campaigns/${googleId}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status, account: activeAccount }),
      });
      setCampaigns((prev) => prev.map((c) =>
        c.google_campaign_id === googleId ? { ...c, status } : c
      ));
    } catch { setError('Failed to update campaign status'); }
  };

  const handleBudgetChange = async (googleId: string, budgetNgn: number) => {
    try {
      const res = await api(`/api/google/campaigns/${googleId}/budget`, {
        method: 'PUT',
        body: JSON.stringify({ daily_budget_ngn: budgetNgn, account_key: activeAccount }),
      });
      if (res.success) {
        setCampaigns((prev) => prev.map((c) =>
          c.google_campaign_id === googleId
            ? { ...c, budget_amount_micros: Math.round(budgetNgn * 1_000_000) }
            : c
        ));
      } else {
        setError(res.error || 'Failed to update budget');
      }
    } catch { setError('Failed to update budget'); }
  };

  // ── Draft actions ──────────────────────────────────────────────────────────

  const handleApprove = async (id: string) => {
    const res = await api(`/api/google/drafts/${id}/approve`, { method: 'PUT' });
    if (res.success) loadDrafts();
  };

  const handleReject = async (id: string) => {
    const res = await api(`/api/google/drafts/${id}/reject`, {
      method: 'PUT',
      body: JSON.stringify({ note: rejectNote }),
    });
    if (res.success) { setRejectingId(null); setRejectNote(''); loadDrafts(); }
  };

  const handleDeleteDraft = async (id: string, title: string, published: boolean) => {
    const extra = published
      ? ' This only removes the record here. The ad may still exist in Google Ads Manager.'
      : '';
    if (!window.confirm(`Delete "${title}"?${extra}`)) return;
    setDeletingId(id);
    setError('');
    try {
      const res = await api(`/api/google/drafts/${id}`, { method: 'DELETE' });
      if (res.success) {
        if (expandedDraft === id) setExpandedDraft(null);
        if (publishingId === id) setPublishingId(null);
        loadDrafts();
      } else setError(res.error || 'Delete failed');
    } catch { setError('Delete failed'); }
    finally { setDeletingId(null); }
  };

  const handlePublish = async (id: string) => {
    const hasExisting = accountCampaigns.filter((c) => c.status === 'ENABLED' || c.status === 'PAUSED').length > 0;
    const creatingNew = publishCampaign === '__new__';
    if (hasExisting && !publishCampaign) { setError('Select a campaign first'); return; }
    if (creatingNew && !publishCampaignName.trim()) { setError('Enter a name for the new campaign'); return; }
    if (!hasExisting && !publishCampaignName.trim()) { setError('Enter a campaign name'); return; }
    if (!publishBudget || Number(publishBudget) < GOOGLE_PUBLISH_MIN_DAILY_BUDGET_NGN) {
      setError(`Enter a daily budget of at least ₦${GOOGLE_PUBLISH_MIN_DAILY_BUDGET_NGN.toLocaleString()}`);
      return;
    }
    setPublishing(true);
    setError('');
    try {
      const payload: Record<string, unknown> = {
        account: activeAccount,
        daily_budget_ngn: Number(publishBudget),
      };
      if (publishCampaign && !creatingNew) payload.campaign_id = publishCampaign;
      else payload.new_campaign_name = publishCampaignName.trim();

      const res = await api(`/api/google/drafts/${id}/publish`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (res.success) {
        setPublishingId(null);
        setPublishCampaign('');
        setPublishCampaignName('');
        setPublishBudget('');
        loadDrafts();
        const syncRes = await api('/api/google/campaigns/sync', {
          method: 'POST',
          body: JSON.stringify({ account: activeAccount }),
        });
        await loadCampaigns();
        setTab('campaigns');
        if (!syncRes?.success && syncRes?.error) {
          setError('Published! But campaign list did not refresh: ' + syncRes.error);
        }
      } else setError(res.error || 'Publish failed');
    } catch { setError('Publish failed'); }
    finally { setPublishing(false); }
  };

  // ── AI Generate ────────────────────────────────────────────────────────────

  const handleGenerate = async () => {
    setGenerating(true);
    setVariations([]);
    setPreviewIdx(null);
    setError('');
    try {
      const res = await api('/api/google/ai/generate', {
        method: 'POST',
        body: JSON.stringify({
          account:   activeAccount,
          objective: genObjective,
          tone:      genTone,
          count:     genCount,
          brief:     genBrief.trim() || undefined,
        }),
      });
      if (res.success) {
        setVariations(res.data);
        setPreviewIdx(0);
      } else setError(res.error || 'Generation failed');
    } catch { setError('Generation failed'); }
    finally { setGenerating(false); }
  };

  const saveVariationAsDraft = async (v: RsaVariation) => {
    const res = await api('/api/google/drafts', {
      method: 'POST',
      body: JSON.stringify({
        account_key:          activeAccount,
        title:                v.headlines[0] || 'AI Draft',
        headlines:            v.headlines,
        descriptions:         v.descriptions,
        call_to_action:       v.call_to_action,
        ai_generated:         true,
        suggested_budget_ngn: v.suggested_budget_ngn || null,
        final_url:            null,
      }),
    });
    if (res.success) { await loadDrafts(); setTab('drafts'); }
    else setError(res.error || 'Failed to save draft');
  };

  // ── Aggregate stats (account-scoped) ──────────────────────────────────────

  const totals = accountCampaigns.reduce(
    (acc, c) => ({
      spend:       acc.spend + microToNgn(c.cost_micros || 0),
      impressions: acc.impressions + Number(c.impressions || 0),
      clicks:      acc.clicks + Number(c.clicks || 0),
      conversions: acc.conversions + Number(c.conversions || 0),
    }),
    { spend: 0, impressions: 0, clicks: 0, conversions: 0 }
  );
  const avgCtr = totals.impressions > 0
    ? ((totals.clicks / totals.impressions) * 100).toFixed(2)
    : '0.00';
  const alertCampaigns = accountCampaigns.filter(isAlertCampaign);
  const pendingDrafts  = accountDrafts.filter((d) => d.status === 'draft').length;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 ${activeAccountInfo.bg} rounded-xl flex items-center justify-center`}>
            <activeAccountInfo.icon className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Google Ads</h1>
            <p className="text-sm text-gray-500">Search, campaigns & AI-powered RSA content</p>
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

      {/* Account switcher */}
      <div className="flex gap-2 flex-wrap">
        {ACCOUNTS.map((acc) => {
          const Icon = acc.icon;
          const isActive = activeAccount === acc.key;
          const accDrafts = drafts.filter((d) => d.account_key === acc.key && d.status === 'draft').length;
          return (
            <button
              key={acc.key}
              onClick={() => { setActiveAccount(acc.key); setTab('campaigns'); setError(''); }}
              className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                isActive
                  ? `${acc.bg} text-white border-transparent shadow-sm`
                  : 'bg-white text-gray-700 border-gray-200 hover:border-gray-300 hover:bg-gray-50'
              }`}
            >
              <Icon className="w-4 h-4" />
              <div className="text-left">
                <div className="leading-none">{acc.name}</div>
                <div className={`text-xs mt-0.5 ${isActive ? 'opacity-75' : 'text-gray-400'}`}>{acc.description}</div>
              </div>
              {accDrafts > 0 && !isActive && (
                <span className="ml-1 bg-blue-100 text-blue-700 text-xs px-1.5 py-0.5 rounded-full">
                  {accDrafts}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
          <button onClick={() => setError('')} className="ml-auto text-red-400 hover:text-red-600">✕</button>
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
              {alertCampaigns.map((c) => c.name).join(', ')} — spending but CTR below 1%. Consider pausing or refreshing your RSA copy.
            </p>
          </div>
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={DollarSign}   label="Total Spend"   value={fmt(totals.spend)}          color="bg-blue-50 text-blue-600" />
        <StatCard icon={Eye}          label="Impressions"   value={fmtNum(totals.impressions)}  color="bg-purple-50 text-purple-600" />
        <StatCard icon={MousePointer} label="Clicks"        value={fmtNum(totals.clicks)}       sub={`${avgCtr}% CTR`} color="bg-green-50 text-green-600" />
        <StatCard icon={Target}       label="Conversions"   value={totals.conversions.toFixed(1)} color="bg-orange-50 text-orange-600" />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        {(['campaigns', 'drafts', 'generate', 'creator'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors capitalize ${
              tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {t === 'generate' ? 'AI Generate' : t === 'creator' ? 'Ad Creator' : t}
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

      {/* ── Campaigns tab ──────────────────────────────────────────────────────── */}
      {tab === 'campaigns' && (
        <>
          {loading ? (
            <div className="bg-white rounded-xl border border-gray-200 py-12 text-center text-gray-500 text-sm">
              Loading campaigns…
            </div>
          ) : accountCampaigns.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 py-12 text-center text-gray-500 text-sm">
              <BarChart2 className="w-10 h-10 text-gray-200 mx-auto mb-3" />
              <p>No campaigns cached for <strong>{activeAccountInfo.name}</strong>.</p>
              <p className="mt-1">Click <strong>Sync Campaigns</strong> to fetch from Google Ads.</p>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {accountCampaigns.map((c) => (
                <CampaignCard key={c.id} campaign={c} onStatusChange={handleStatusChange} onBudgetChange={handleBudgetChange} />
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Drafts tab ────────────────────────────────────────────────────────── */}
      {tab === 'drafts' && (
        <div className="space-y-3">
          {accountDrafts.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 py-12 text-center text-gray-500 text-sm">
              <FileText className="w-10 h-10 text-gray-200 mx-auto mb-3" />
              No drafts for <strong>{activeAccountInfo.name}</strong> yet. Use <strong>AI Generate</strong> or <strong>Ad Creator</strong> to build one.
            </div>
          ) : (
            accountDrafts.map((d) => (
              <div key={d.id} className="bg-white rounded-xl border border-gray-200">
                {/* Row header */}
                <div
                  className="flex items-center justify-between px-5 py-4 cursor-pointer"
                  onClick={() => setExpandedDraft(expandedDraft === d.id ? null : d.id)}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {d.ai_generated && <Sparkles className="w-4 h-4 text-purple-500 shrink-0" />}
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 text-sm truncate">{d.title}</p>
                      <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
                        <span>{new Date(d.created_at).toLocaleDateString()}</span>
                        <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${CAMPAIGN_TYPE_COLOR[d.campaign_type] || 'bg-gray-100 text-gray-700'}`}>
                          {d.campaign_type === 'VIDEO'   && <Video   className="w-2.5 h-2.5" />}
                          {d.campaign_type === 'DISPLAY' && <ImageIcon2 className="w-2.5 h-2.5" />}
                          {d.campaign_type === 'SEARCH'  && <Search  className="w-2.5 h-2.5" />}
                          {CAMPAIGN_TYPE_LABEL[d.campaign_type] || d.campaign_type}
                        </span>
                        {d.users && <span>· {d.users.full_name}</span>}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${DRAFT_STATUS_COLOR[d.status] || 'bg-gray-100'}`}>
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
                    {expandedDraft === d.id
                      ? <ChevronUp className="w-4 h-4 text-gray-400" />
                      : <ChevronDown className="w-4 h-4 text-gray-400" />
                    }
                  </div>
                </div>

                {/* Expanded content */}
                {expandedDraft === d.id && (
                  <div className="border-t border-gray-100 px-5 py-5 space-y-5">
                    <div className="grid lg:grid-cols-2 gap-6">
                      {/* Content */}
                      <div className="space-y-4">
                        <div>
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                            Headlines ({d.headlines.length})
                          </p>
                          <div className="space-y-1">
                            {d.headlines.map((h, i) => (
                              <div key={i} className="flex items-center gap-2 text-sm">
                                <span className="text-xs text-gray-400 w-4 shrink-0">{i + 1}</span>
                                <p className="text-gray-800 font-medium">{h}</p>
                                <span className={`ml-auto text-xs ${h.length > 28 ? 'text-amber-600' : 'text-gray-400'}`}>{h.length}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                            Descriptions ({d.descriptions.length})
                          </p>
                          <div className="space-y-1.5">
                            {d.descriptions.map((desc, i) => (
                              <div key={i} className="flex items-start gap-2 text-sm">
                                <span className="text-xs text-gray-400 w-4 shrink-0 mt-0.5">{i + 1}</span>
                                <p className="text-gray-700 leading-relaxed">{desc}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                        {d.final_url && (
                          <div className="flex items-center gap-2 text-xs">
                            <Globe className="w-3.5 h-3.5 text-gray-400" />
                            <a href={d.final_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline truncate">
                              {d.final_url}
                            </a>
                          </div>
                        )}
                        {d.rejection_note && (
                          <p className="text-xs text-red-700 bg-red-50 rounded-lg px-3 py-2">
                            Rejected: {d.rejection_note}
                          </p>
                        )}
                      </div>
                      {/* Preview */}
                      <GoogleAdPreview
                        headlines={d.headlines}
                        descriptions={d.descriptions}
                        displayUrl={activeAccountInfo.website}
                        account={activeAccountInfo}
                      />
                    </div>

                    {/* Draft actions */}
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

                    {/* Publish panel */}
                    {d.status === 'approved' && (
                      <div className="space-y-3">
                        {publishingId !== d.id ? (
                          <button
                            onClick={() => {
                              setPublishingId(d.id);
                              setPublishCampaign('');
                              setPublishCampaignName('');
                              setPublishBudget(String(d.suggested_budget_ngn || ''));
                            }}
                            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                          >
                            <Send className="w-4 h-4" /> Publish to Google Ads
                          </button>
                        ) : (
                          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-3">
                            <p className="text-sm font-semibold text-blue-900">Publish to Google Ads</p>

                            {/* Campaign selector */}
                            <div>
                              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Campaign</label>
                              {accountCampaigns.filter((c) => c.status === 'ENABLED' || c.status === 'PAUSED').length > 0 ? (
                                <>
                                  <select
                                    value={publishCampaign}
                                    onChange={(e) => { setPublishCampaign(e.target.value); setPublishCampaignName(''); }}
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                  >
                                    <option value="">Select a campaign…</option>
                                    {accountCampaigns
                                      .filter((c) => c.status === 'ENABLED' || c.status === 'PAUSED')
                                      .map((c) => (
                                        <option key={c.google_campaign_id} value={c.google_campaign_id}>
                                          {c.name}
                                        </option>
                                      ))}
                                    <option value="__new__">+ Create new campaign</option>
                                  </select>
                                  {publishCampaign === '__new__' && (
                                    <input
                                      type="text"
                                      value={publishCampaignName}
                                      onChange={(e) => setPublishCampaignName(e.target.value)}
                                      placeholder={`e.g. ${activeAccountInfo.name} — June Ads`}
                                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mt-2"
                                      autoFocus
                                    />
                                  )}
                                </>
                              ) : (
                                <input
                                  type="text"
                                  value={publishCampaignName}
                                  onChange={(e) => setPublishCampaignName(e.target.value)}
                                  placeholder={`e.g. ${activeAccountInfo.name} — Search Campaign`}
                                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                              )}
                            </div>

                            {/* Budget */}
                            <div>
                              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Daily Budget (₦)</label>
                              <input
                                type="number"
                                min={GOOGLE_PUBLISH_MIN_DAILY_BUDGET_NGN}
                                value={publishBudget}
                                onChange={(e) => setPublishBudget(e.target.value)}
                                placeholder="e.g. 3000"
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                              <p className="text-xs text-gray-400 mt-1">
                                Min ₦{GOOGLE_PUBLISH_MIN_DAILY_BUDGET_NGN.toLocaleString()} · Google spends up to 2× daily budget on high-traffic days
                              </p>
                            </div>

                            <p className="text-xs text-gray-500">Ad will be created as <strong>PAUSED</strong> — activate in Google Ads Manager after review.</p>
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
                        Published to Google Ads
                        {d.published_at ? ` · ${new Date(d.published_at).toLocaleDateString()}` : ''}
                        {d.google_ad_id ? ` · Ad ID: ${d.google_ad_id}` : ''}
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
                <h2 className="font-semibold text-gray-900">Generate RSA Content</h2>
                <span className={`ml-auto text-xs px-2 py-0.5 rounded-full text-white ${activeAccountInfo.bg}`}>
                  {activeAccountInfo.name}
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                  Brief (optional)
                </label>
                <textarea
                  value={genBrief}
                  onChange={(e) => setGenBrief(e.target.value)}
                  rows={3}
                  placeholder={
                    activeAccount === 'julinemart'
                      ? 'e.g. Promote flash sale on electronics, free delivery within Lagos'
                      : activeAccount === 'services'
                      ? 'e.g. Promote home cleaning services in Lagos and Abuja'
                      : 'e.g. Promote SkolaHQ free trial for secondary school principals'
                  }
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Objective</label>
                  <select
                    value={genObjective}
                    onChange={(e) => setGenObjective(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
                  >
                    {activeAccount === 'skolahq' ? (
                      <>
                        <option value="leads">Lead Generation</option>
                        <option value="trials">Free Trial Sign-ups</option>
                        <option value="demos">Book a Demo</option>
                        <option value="awareness">Brand Awareness</option>
                      </>
                    ) : activeAccount === 'services' ? (
                      <>
                        <option value="bookings">Service Bookings</option>
                        <option value="leads">Lead Generation</option>
                        <option value="awareness">Awareness</option>
                        <option value="app_installs">App Installs</option>
                      </>
                    ) : (
                      <>
                        <option value="sales">Sales</option>
                        <option value="traffic">Traffic</option>
                        <option value="awareness">Awareness</option>
                        <option value="app_installs">App Installs</option>
                      </>
                    )}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Tone</label>
                  <select
                    value={genTone}
                    onChange={(e) => setGenTone(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
                  >
                    <option value="engaging">Engaging</option>
                    <option value="urgent">Urgent</option>
                    <option value="friendly">Friendly</option>
                    <option value="bold">Bold</option>
                    <option value="professional">Professional</option>
                    {activeAccount === 'skolahq' && <option value="authoritative">Authoritative</option>}
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
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
                />
              </div>

              {/* Account context info */}
              <div className={`text-xs rounded-lg px-3 py-2.5 space-y-1 ${
                activeAccount === 'skolahq'   ? 'bg-purple-50 text-purple-800' :
                activeAccount === 'services'  ? 'bg-green-50 text-green-800' :
                'bg-blue-50 text-blue-800'
              }`}>
                <p className="font-semibold flex items-center gap-1">
                  <activeAccountInfo.icon className="w-3 h-3" /> {activeAccountInfo.name}
                </p>
                {activeAccount === 'julinemart' && <p>E-commerce · Nigeria · Free delivery · JulineMart.com</p>}
                {activeAccount === 'services' && <p>Service marketplace · Lagos & Abuja · Verified artisans & professionals</p>}
                {activeAccount === 'skolahq' && <p>School management SaaS · Nigeria · Signup at app.skolahq.com</p>}
                <p className="opacity-75">AI will tailor all {genCount} variation{genCount > 1 ? 's' : ''} for this business context automatically</p>
              </div>

              <button
                onClick={handleGenerate}
                disabled={generating}
                className="w-full flex items-center justify-center gap-2 bg-purple-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-60 transition-colors"
              >
                <Sparkles className={`w-4 h-4 ${generating ? 'animate-pulse' : ''}`} />
                {generating ? 'Generating RSA copy…' : 'Generate with AI'}
              </button>
            </div>

            {/* Preview panel */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-gray-700">Google Search Preview</h3>
              {variations.length > 0 && previewIdx !== null ? (
                <>
                  <div className="flex gap-2 flex-wrap">
                    {variations.map((_, i) => (
                      <button
                        key={i}
                        onClick={() => setPreviewIdx(i)}
                        className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${
                          previewIdx === i ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        Var {i + 1}
                      </button>
                    ))}
                  </div>
                  <GoogleAdPreview
                    headlines={variations[previewIdx].headlines}
                    descriptions={variations[previewIdx].descriptions}
                    displayUrl={activeAccountInfo.website}
                    account={activeAccountInfo}
                  />
                </>
              ) : (
                <div className="bg-gray-50 rounded-xl border border-gray-200 py-12 text-center text-gray-500 text-sm">
                  {generating ? (
                    <>
                      <Sparkles className="w-8 h-8 text-purple-400 mx-auto animate-pulse mb-3" />
                      <p className="text-purple-700 font-medium">Generating RSA variations…</p>
                    </>
                  ) : (
                    <>
                      <Search className="w-8 h-8 text-gray-200 mx-auto mb-3" />
                      Generate variations to see a Google Search preview
                    </>
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
                  className={`bg-white rounded-xl border p-5 space-y-4 cursor-pointer transition-all ${
                    previewIdx === i ? 'border-purple-300 ring-1 ring-purple-200' : 'border-gray-200 hover:border-gray-300'
                  }`}
                  onClick={() => setPreviewIdx(i)}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-purple-600 uppercase tracking-wide flex items-center gap-1">
                      <Sparkles className="w-3.5 h-3.5" /> Variation {i + 1}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">{v.call_to_action}</span>
                      {v.suggested_budget_ngn && (
                        <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded">
                          Suggested: {fmt(v.suggested_budget_ngn)}/day
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Headlines ({v.headlines.length})</p>
                      <div className="space-y-1">
                        {v.headlines.map((h, j) => (
                          <div key={j} className="flex items-center gap-2 text-sm">
                            <span className="text-xs text-gray-400 w-4 shrink-0">{j + 1}</span>
                            <p className="text-gray-800">{h}</p>
                            <span className={`ml-auto text-xs shrink-0 ${h.length > 28 ? 'text-amber-600' : 'text-gray-300'}`}>{h.length}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Descriptions ({v.descriptions.length})</p>
                      <div className="space-y-1.5">
                        {v.descriptions.map((d, j) => (
                          <p key={j} className="text-sm text-gray-700 leading-relaxed">{j + 1}. {d}</p>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-1" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => saveVariationAsDraft(v)}
                      className="flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors"
                    >
                      <Plus className="w-4 h-4" /> Save as Draft
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Ad Creator tab ────────────────────────────────────────────────────── */}
      {tab === 'creator' && (
        <AdCreator
          account={activeAccountInfo}
          onSaved={() => { loadDrafts(); setTab('drafts'); }}
        />
      )}
    </div>
  );
}

// ─── Ad Creator (Search · Display · Video) ──────────────────────────────────────

function AdCreator({ account, onSaved }: { account: AccountInfo; onSaved: () => void }) {
  const DEFAULT_HEADLINES    = ['', '', ''];
  const DEFAULT_DESCRIPTIONS = ['', ''];

  // shared fields
  const [campaignType, setCampaignType] = useState<'SEARCH' | 'DISPLAY' | 'VIDEO'>('SEARCH');
  const [title, setTitle]               = useState('');
  const [finalUrl, setFinalUrl]         = useState('');
  const [cta, setCta]                   = useState('LEARN_MORE');
  const [budgetNgn, setBudgetNgn]       = useState('');
  const [saving, setSaving]             = useState(false);
  const [error, setError]               = useState('');

  // Search / Display copy fields (shared)
  const [headlines, setHeadlines]       = useState<string[]>(DEFAULT_HEADLINES);
  const [descriptions, setDescriptions] = useState<string[]>(DEFAULT_DESCRIPTIONS);

  // Display-specific
  const [imageUrl, setImageUrl]         = useState('');
  const [imageUrlSquare, setImageUrlSquare] = useState('');
  const [logoUrl, setLogoUrl]           = useState('');
  const [longHeadline, setLongHeadline] = useState('');

  // Video-specific
  const [videoUrl, setVideoUrl]         = useState('');
  const [videoActionHeadline, setVideoActionHeadline] = useState('');

  // AI assist (only for Search)
  const [brief, setBrief]               = useState('');
  const [tone, setTone]                 = useState('professional');
  const [assisting, setAssisting]       = useState(false);
  const [suggestions, setSuggestions]   = useState<RsaVariation[]>([]);

  const CTA_OPTIONS = [
    { value: 'LEARN_MORE',  label: 'Learn More' },
    { value: 'SIGN_UP',     label: 'Sign Up' },
    { value: 'GET_STARTED', label: 'Get Started' },
    { value: 'CONTACT_US',  label: 'Contact Us' },
    { value: 'BOOK_NOW',    label: 'Book Now' },
    { value: 'SHOP_NOW',    label: 'Shop Now' },
    { value: 'GET_OFFER',   label: 'Get Offer' },
    { value: 'SUBSCRIBE',   label: 'Subscribe' },
  ];

  const handleAiAssist = async () => {
    if (!brief.trim()) { setError('Enter a brief first'); return; }
    setAssisting(true); setError(''); setSuggestions([]);
    try {
      const res = await api('/api/google/ai/assist', {
        method: 'POST',
        body: JSON.stringify({ brief, tone, account: account.key, cta }),
      });
      if (res.success) setSuggestions(res.data);
      else setError(res.error || 'AI assist failed');
    } catch { setError('AI assist failed'); }
    finally { setAssisting(false); }
  };

  const applySuggestion = (s: RsaVariation) => {
    setHeadlines(s.headlines);
    setDescriptions(s.descriptions);
    setSuggestions([]);
  };

  const reset = () => {
    setHeadlines(DEFAULT_HEADLINES); setDescriptions(DEFAULT_DESCRIPTIONS);
    setTitle(''); setFinalUrl(''); setBudgetNgn('');
    setImageUrl(''); setImageUrlSquare(''); setLogoUrl(''); setLongHeadline('');
    setVideoUrl(''); setVideoActionHeadline('');
  };

  const handleSave = async () => {
    const validHeadlines    = headlines.filter((h) => h.trim());
    const validDescriptions = descriptions.filter((d) => d.trim());
    setError('');

    if (campaignType === 'SEARCH') {
      if (validHeadlines.length < 3)    { setError('Add at least 3 headlines'); return; }
      if (validDescriptions.length < 2) { setError('Add at least 2 descriptions'); return; }
      if (validHeadlines.some((h) => h.length > 30))  { setError('All headlines must be ≤ 30 characters'); return; }
      if (validDescriptions.some((d) => d.length > 90)) { setError('All descriptions must be ≤ 90 characters'); return; }
    }
    if (campaignType === 'DISPLAY') {
      if (!imageUrl.trim())              { setError('Landscape image URL is required for Display ads'); return; }
      if (!longHeadline.trim())          { setError('Long headline is required for Display ads'); return; }
      if (longHeadline.length > 90)      { setError('Long headline must be ≤ 90 characters'); return; }
      if (validHeadlines.length < 1)     { setError('Add at least 1 short headline for Display ads'); return; }
      if (validHeadlines.some((h) => h.length > 30))  { setError('Short headlines must be ≤ 30 characters'); return; }
      if (validDescriptions.length < 1)  { setError('Add at least 1 description for Display ads'); return; }
    }
    if (campaignType === 'VIDEO') {
      if (!videoUrl.trim())              { setError('YouTube video URL is required'); return; }
      if (!videoActionHeadline.trim())   { setError('In-stream action headline is required'); return; }
      if (videoActionHeadline.length > 80) { setError('Action headline must be ≤ 80 characters'); return; }
    }
    if (!finalUrl.trim()) { setError('Final URL is required'); return; }

    const draftHeadlines    = campaignType === 'VIDEO'
      ? [videoActionHeadline, ...validHeadlines].filter(Boolean)
      : validHeadlines;
    const draftDescriptions = validDescriptions.length > 0
      ? validDescriptions
      : ['See more details online'];

    setSaving(true);
    try {
      const res = await api('/api/google/drafts', {
        method: 'POST',
        body: JSON.stringify({
          account_key:          account.key,
          title:                title.trim() || draftHeadlines[0] || videoUrl,
          headlines:            draftHeadlines,
          descriptions:         draftDescriptions,
          final_url:            finalUrl.trim(),
          call_to_action:       cta,
          campaign_type:        campaignType,
          ai_generated:         false,
          suggested_budget_ngn: budgetNgn ? Number(budgetNgn) : null,
          // media fields
          image_url:            imageUrl.trim()       || null,
          image_url_square:     imageUrlSquare.trim() || null,
          logo_url:             logoUrl.trim()        || null,
          long_headline:        (campaignType === 'DISPLAY' ? longHeadline.trim()
                                : campaignType === 'VIDEO'  ? videoActionHeadline.trim()
                                : null) || null,
          video_url:            videoUrl.trim()       || null,
        }),
      });
      if (res.success) { reset(); onSaved(); }
      else setError(res.error || 'Save failed');
    } catch { setError('Save failed'); }
    finally { setSaving(false); }
  };

  // ── Type tabs ──────────────────────────────────────────────────────────────
  const typeTabs: { key: 'SEARCH' | 'DISPLAY' | 'VIDEO'; label: string; icon: React.ElementType; desc: string }[] = [
    { key: 'SEARCH',  label: 'Search',  icon: Search,     desc: 'Text-only — appears in Google search results' },
    { key: 'DISPLAY', label: 'Display', icon: ImageIcon2, desc: 'Image banners — shown across websites' },
    { key: 'VIDEO',   label: 'Video',   icon: Video,      desc: 'YouTube in-stream — skippable pre-roll ads' },
  ];

  const validH = headlines.filter((h) => h.trim());
  const validD = descriptions.filter((d) => d.trim());

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      {/* ── Left: Editor ───────────────────────────────────────────────────── */}
      <div className="space-y-5">
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-5">

          {/* Ad type selector */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Wand2 className="w-5 h-5 text-blue-600" />
              <h2 className="font-semibold text-gray-900">Ad Creator</h2>
              <span className={`ml-auto text-xs px-2 py-0.5 rounded-full text-white ${account.bg}`}>
                {account.name}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {typeTabs.map((t) => (
                <button
                  key={t.key}
                  onClick={() => { setCampaignType(t.key); setError(''); }}
                  className={`flex flex-col items-center gap-1.5 px-3 py-3 rounded-lg border-2 text-xs font-medium transition-colors text-center ${
                    campaignType === t.key
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-200 text-gray-500 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <t.icon className="w-4 h-4" />
                  {t.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-1.5">
              {typeTabs.find((t) => t.key === campaignType)?.desc}
            </p>
          </div>

          {error && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" /> {error}
            </div>
          )}

          {/* Draft title */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Draft Title (internal)</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={campaignType === 'VIDEO' ? 'e.g. SkolaHQ YouTube June' : 'e.g. JulineMart Flash Sale'}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* ── Search fields ── */}
          {campaignType === 'SEARCH' && (
            <RsaEditor
              headlines={headlines}
              descriptions={descriptions}
              onChangeHeadlines={setHeadlines}
              onChangeDescriptions={setDescriptions}
            />
          )}

          {/* ── Display fields ── */}
          {campaignType === 'DISPLAY' && (
            <div className="space-y-4">
              {/* Images */}
              <div className="bg-purple-50 border border-purple-100 rounded-lg p-3 space-y-3">
                <p className="text-xs font-semibold text-purple-700 flex items-center gap-1.5">
                  <ImageIcon2 className="w-3.5 h-3.5" /> Images
                </p>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                    Landscape Image URL <span className="text-red-500">*</span>
                    <span className="ml-1 font-normal normal-case text-gray-400">(1.91:1 ratio — e.g. 1200×628px)</span>
                  </label>
                  <input
                    type="url"
                    value={imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                    placeholder="https://cdn.julinemart.com/banner.jpg"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                    Square Image URL
                    <span className="ml-1 font-normal normal-case text-gray-400">(optional, 1:1 — e.g. 1200×1200px)</span>
                  </label>
                  <input
                    type="url"
                    value={imageUrlSquare}
                    onChange={(e) => setImageUrlSquare(e.target.value)}
                    placeholder="https://cdn.julinemart.com/square.jpg (or leave blank to reuse landscape)"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                    Logo URL <span className="font-normal normal-case text-gray-400">(optional)</span>
                  </label>
                  <input
                    type="url"
                    value={logoUrl}
                    onChange={(e) => setLogoUrl(e.target.value)}
                    placeholder="https://cdn.julinemart.com/logo.png"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
                  />
                </div>
              </div>

              {/* Headlines */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                  Long Headline <span className="text-red-500">*</span>
                  <span className="ml-1 font-normal normal-case text-gray-400">(max 90 chars)</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    maxLength={90}
                    value={longHeadline}
                    onChange={(e) => setLongHeadline(e.target.value)}
                    placeholder="e.g. Shop Nigeria's widest selection of fashion & electronics"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 pr-12"
                  />
                  <span className={`absolute right-3 top-2.5 text-xs ${longHeadline.length > 85 ? 'text-red-500' : 'text-gray-400'}`}>
                    {longHeadline.length}/90
                  </span>
                </div>
              </div>

              <RsaEditor
                headlines={headlines}
                descriptions={descriptions}
                onChangeHeadlines={setHeadlines}
                onChangeDescriptions={setDescriptions}
                maxHeadlines={5}
                headlineLabel="Short Headlines (shown in banner)"
                headlineHint="(up to 5, max 30 chars each)"
                descriptionLabel="Descriptions"
                descriptionHint="(up to 5, max 90 chars each)"
              />
            </div>
          )}

          {/* ── Video fields ── */}
          {campaignType === 'VIDEO' && (
            <div className="space-y-4">
              <div className="bg-red-50 border border-red-100 rounded-lg p-3 space-y-3">
                <p className="text-xs font-semibold text-red-700 flex items-center gap-1.5">
                  <Video className="w-3.5 h-3.5" /> YouTube Video
                </p>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                    YouTube Video URL <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="url"
                    value={videoUrl}
                    onChange={(e) => setVideoUrl(e.target.value)}
                    placeholder="https://www.youtube.com/watch?v=..."
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
                  />
                  <p className="text-xs text-gray-400 mt-1">The video must already be uploaded to your YouTube channel</p>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                  In-Stream Action Headline <span className="text-red-500">*</span>
                  <span className="ml-1 font-normal normal-case text-gray-400">(shown next to CTA button, max 80 chars)</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    maxLength={80}
                    value={videoActionHeadline}
                    onChange={(e) => setVideoActionHeadline(e.target.value)}
                    placeholder="e.g. Try SkolaHQ free — manage your school in minutes"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 pr-12"
                  />
                  <span className={`absolute right-3 top-2.5 text-xs ${videoActionHeadline.length > 75 ? 'text-red-500' : 'text-gray-400'}`}>
                    {videoActionHeadline.length}/80
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Final URL + CTA */}
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                Final URL <span className="text-red-500">*</span>
              </label>
              <input
                type="url"
                value={finalUrl}
                onChange={(e) => setFinalUrl(e.target.value)}
                placeholder={`https://${account.website}/`}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Call to Action</label>
              <select
                value={cta}
                onChange={(e) => setCta(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {CTA_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Suggested Budget (₦)</label>
              <input
                type="number"
                min={0}
                value={budgetNgn}
                onChange={(e) => setBudgetNgn(e.target.value)}
                placeholder="e.g. 3000"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <p className="text-xs text-gray-400 -mt-3">Suggested budget is a hint for the reviewer — not enforced</p>

          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60 transition-colors"
          >
            <FileText className={`w-4 h-4 ${saving ? 'animate-pulse' : ''}`} />
            {saving ? 'Saving…' : 'Save as Draft'}
          </button>
        </div>

        {/* AI Assist — only shown for Search ads */}
        {campaignType === 'SEARCH' && (
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Wand2 className="w-4 h-4 text-purple-600" />
              <h3 className="font-semibold text-gray-900 text-sm">AI Assist</h3>
            </div>
            <textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              rows={2}
              placeholder="Describe what you want to promote…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 resize-none"
            />
            <div className="flex gap-3 items-end">
              <div className="flex-1">
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Tone</label>
                <select
                  value={tone}
                  onChange={(e) => setTone(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
                >
                  <option value="professional">Professional</option>
                  <option value="engaging">Engaging</option>
                  <option value="urgent">Urgent</option>
                  <option value="friendly">Friendly</option>
                </select>
              </div>
              <button
                onClick={handleAiAssist}
                disabled={assisting}
                className="flex items-center gap-2 bg-purple-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-60 transition-colors"
              >
                <Sparkles className={`w-4 h-4 ${assisting ? 'animate-pulse' : ''}`} />
                {assisting ? 'Thinking…' : 'Suggest copy'}
              </button>
            </div>
            {suggestions.length > 0 && (
              <div className="space-y-2 border-t border-gray-100 pt-3">
                {suggestions.map((s, i) => (
                  <div key={i} className="bg-purple-50 rounded-lg p-3 space-y-1">
                    <p className="text-xs text-purple-700 font-medium">Suggestion {i + 1}</p>
                    <p className="text-xs text-gray-700">{s.headlines[0]} | {s.headlines[1]}</p>
                    <p className="text-xs text-gray-500">{s.descriptions[0]}</p>
                    <button
                      onClick={() => applySuggestion(s)}
                      className="text-xs text-purple-600 font-medium hover:text-purple-700 mt-1"
                    >Apply →</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Right: Preview + Checklist ─────────────────────────────────────── */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-gray-700">Live Preview</h3>

        {campaignType === 'SEARCH' && (
          <GoogleAdPreview
            headlines={validH}
            descriptions={validD}
            displayUrl={account.website}
            account={account}
          />
        )}

        {campaignType === 'DISPLAY' && (
          <DisplayAdPreview
            imageUrl={imageUrl}
            shortHeadlines={validH}
            longHeadline={longHeadline}
            descriptions={validD}
            businessName={account.name}
            finalUrl={finalUrl || account.website}
            cta={cta}
          />
        )}

        {campaignType === 'VIDEO' && (
          <VideoAdPreview
            videoUrl={videoUrl}
            actionHeadline={videoActionHeadline}
            cta={cta}
            finalUrl={finalUrl || account.website}
          />
        )}

        {/* Quality checklist */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            {campaignType === 'SEARCH' ? 'RSA' : campaignType === 'DISPLAY' ? 'Display RDA' : 'Video In-Stream'} Checklist
          </p>
          {campaignType === 'SEARCH' && (<>
            <QualityCheck label="At least 3 headlines" ok={validH.length >= 3} />
            <QualityCheck label="At least 2 descriptions" ok={validD.length >= 2} />
            <QualityCheck label="All headlines ≤ 30 chars" ok={validH.length > 0 && validH.every((h) => h.length <= 30)} />
            <QualityCheck label="All descriptions ≤ 90 chars" ok={validD.length > 0 && validD.every((d) => d.length <= 90)} />
            <QualityCheck label="Final URL set" ok={finalUrl.trim().startsWith('http')} />
            <QualityCheck label="Recommended: 8+ headlines" ok={validH.length >= 8} warn />
          </>)}
          {campaignType === 'DISPLAY' && (<>
            <QualityCheck label="Landscape image URL set" ok={imageUrl.trim().startsWith('http')} />
            <QualityCheck label="Long headline set" ok={longHeadline.trim().length > 0} />
            <QualityCheck label="Long headline ≤ 90 chars" ok={longHeadline.length > 0 && longHeadline.length <= 90} />
            <QualityCheck label="At least 1 short headline" ok={validH.length >= 1} />
            <QualityCheck label="Short headlines ≤ 30 chars" ok={validH.length > 0 && validH.every((h) => h.length <= 30)} />
            <QualityCheck label="At least 1 description" ok={validD.length >= 1} />
            <QualityCheck label="Final URL set" ok={finalUrl.trim().startsWith('http')} />
            <QualityCheck label="Square image for more placements" ok={imageUrlSquare.trim().startsWith('http')} warn />
          </>)}
          {campaignType === 'VIDEO' && (<>
            <QualityCheck label="YouTube URL set" ok={videoUrl.trim().startsWith('http')} />
            <QualityCheck label="Action headline set" ok={videoActionHeadline.trim().length > 0} />
            <QualityCheck label="Action headline ≤ 80 chars" ok={videoActionHeadline.length > 0 && videoActionHeadline.length <= 80} />
            <QualityCheck label="CTA selected" ok={!!cta} />
            <QualityCheck label="Final URL set" ok={finalUrl.trim().startsWith('http')} />
          </>)}
        </div>
      </div>
    </div>
  );
}

// ─── Display Ad Preview ──────────────────────────────────────────────────────

function DisplayAdPreview({ imageUrl, shortHeadlines, longHeadline, descriptions, businessName, finalUrl, cta }: {
  imageUrl: string; shortHeadlines: string[]; longHeadline: string;
  descriptions: string[]; businessName: string; finalUrl: string; cta: string;
}) {
  const ctaLabel: Record<string, string> = {
    LEARN_MORE: 'Learn More', SIGN_UP: 'Sign Up', GET_STARTED: 'Get Started',
    CONTACT_US: 'Contact Us', BOOK_NOW: 'Book Now', SHOP_NOW: 'Shop Now',
    GET_OFFER: 'Get Offer', SUBSCRIBE: 'Subscribe',
  };
  const domain = (() => { try { return new URL(finalUrl).hostname; } catch { return finalUrl; } })();
  return (
    <div className="bg-white rounded-xl border-2 border-gray-200 overflow-hidden shadow-sm">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 border-b border-gray-100">
        <Globe className="w-3 h-3 text-gray-400" />
        <span className="text-xs text-gray-400 truncate">{domain}</span>
        <span className="ml-auto text-[10px] text-gray-300 font-medium">Ad</span>
      </div>
      {imageUrl ? (
        <div className="w-full h-36 bg-gray-100 overflow-hidden">
          <img
            src={imageUrl}
            alt="Ad banner"
            className="w-full h-full object-cover"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        </div>
      ) : (
        <div className="w-full h-36 bg-gradient-to-br from-purple-100 to-blue-100 flex items-center justify-center">
          <ImageIcon2 className="w-8 h-8 text-purple-300" />
          <span className="ml-2 text-sm text-purple-400">Landscape image preview</span>
        </div>
      )}
      <div className="p-4 space-y-2">
        <p className="text-xs text-gray-500 font-medium">
          {shortHeadlines[0] || 'Short Headline'}{shortHeadlines[1] ? ` · ${shortHeadlines[1]}` : ''}
        </p>
        <p className="text-sm font-bold text-gray-900 leading-tight">
          {longHeadline || 'Your long headline will appear here up to 90 characters'}
        </p>
        <p className="text-xs text-gray-600 leading-relaxed">
          {descriptions[0] || 'Your description will appear here.'}
        </p>
        <div className="flex items-center justify-between pt-1">
          <span className="text-xs font-semibold text-gray-700">{businessName}</span>
          <span className="text-xs px-3 py-1 bg-blue-600 text-white rounded font-medium">
            {ctaLabel[cta] || cta.replace(/_/g, ' ')}
          </span>
        </div>
      </div>
      <p className="text-[10px] text-gray-400 px-4 pb-2">
        Google rotates short headlines, descriptions, and images across all placements
      </p>
    </div>
  );
}

// ─── Video Ad Preview ────────────────────────────────────────────────────────

function VideoAdPreview({ videoUrl, actionHeadline, cta, finalUrl }: {
  videoUrl: string; actionHeadline: string; cta: string; finalUrl: string;
}) {
  const ctaLabel: Record<string, string> = {
    LEARN_MORE: 'Learn More', SIGN_UP: 'Sign Up', GET_STARTED: 'Get Started',
    CONTACT_US: 'Contact Us', BOOK_NOW: 'Book Now', SHOP_NOW: 'Shop Now',
    GET_OFFER: 'Get Offer', SUBSCRIBE: 'Subscribe',
  };
  const videoId = (() => {
    try {
      const u = new URL(videoUrl);
      if (u.hostname.includes('youtu.be')) return u.pathname.slice(1);
      return u.searchParams.get('v') || '';
    } catch { return ''; }
  })();
  const thumbUrl = videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : '';
  const domain = (() => { try { return new URL(finalUrl).hostname; } catch { return finalUrl; } })();

  return (
    <div className="bg-white rounded-xl border-2 border-gray-200 overflow-hidden shadow-sm">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 border-b border-gray-100">
        <Video className="w-3 h-3 text-red-500" />
        <span className="text-xs text-gray-500 font-medium">YouTube In-Stream Ad</span>
        <span className="ml-auto text-[10px] text-gray-300 font-medium">Ad</span>
      </div>
      <div className="relative w-full h-40 bg-gray-900 flex items-center justify-center overflow-hidden">
        {thumbUrl ? (
          <img
            src={thumbUrl}
            alt="YouTube thumbnail"
            className="w-full h-full object-cover opacity-80"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        ) : (
          <Video className="w-10 h-10 text-gray-600" />
        )}
        {/* Skip button simulation */}
        <div className="absolute bottom-2 right-2 bg-black/70 text-white text-[10px] px-2 py-1 rounded">
          Skip ad in 5 ▶
        </div>
        {/* Play button */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-10 h-10 bg-red-600/90 rounded-full flex items-center justify-center">
            <Play className="w-4 h-4 text-white ml-0.5" />
          </div>
        </div>
      </div>
      <div className="p-4 space-y-2">
        <p className="text-sm font-semibold text-gray-900 leading-tight">
          {actionHeadline || 'Your action headline appears next to the CTA button'}
        </p>
        <div className="flex items-center justify-between">
          <span className="text-xs text-blue-600 truncate">{domain}</span>
          <span className="text-xs px-3 py-1 bg-blue-600 text-white rounded font-medium shrink-0 ml-2">
            {ctaLabel[cta] || cta.replace(/_/g, ' ')}
          </span>
        </div>
      </div>
      {videoId && (
        <p className="text-[10px] text-gray-400 px-4 pb-2 truncate">
          youtube.com/watch?v={videoId}
        </p>
      )}
    </div>
  );
}

function QualityCheck({ label, ok, warn }: { label: string; ok: boolean; warn?: boolean }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      {ok ? (
        <CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0" />
      ) : warn ? (
        <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
      ) : (
        <Clock className="w-3.5 h-3.5 text-gray-300 shrink-0" />
      )}
      <span className={ok ? 'text-green-700' : warn && !ok ? 'text-amber-600' : 'text-gray-400'}>
        {label}
      </span>
    </div>
  );
}
