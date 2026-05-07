import { useEffect, useState, useCallback } from 'react';
import {
  TrendingUp, RefreshCw, Sparkles, CheckCircle, XCircle,
  Clock, Eye, MousePointer, DollarSign, Users, Plus,
  ChevronDown, ChevronUp, AlertCircle, Megaphone,
} from 'lucide-react';

const apiBase = (import.meta as any).env?.VITE_API_BASE_URL || '';
const api = (path: string, opts?: RequestInit) =>
  fetch(`${apiBase}${path}`, {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('sb-access-token') || ''}` },
    ...opts,
  }).then((r) => r.json());

// ─── Types ────────────────────────────────────────────────────────────────────

interface Campaign {
  id: string;
  meta_campaign_id: string;
  name: string;
  status: string;
  objective: string;
  daily_budget: number | null;
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
  status: string;
  ai_generated: boolean;
  suggested_budget: number | null;
  created_at: string;
  users?: { full_name: string; email: string };
}

interface AiVariation {
  headline: string;
  body_text: string;
  call_to_action: string;
}

interface AdsContext {
  top_products: Array<{ name: string; price: number; category: string }>;
  top_region: string | null;
  active_promos: Array<{ code: string; value: number; type: string }>;
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

// ─── Main page ────────────────────────────────────────────────────────────────

export function MetaAdsPage() {
  const [tab, setTab]                 = useState<'campaigns' | 'drafts' | 'generate'>('campaigns');
  const [campaigns, setCampaigns]     = useState<Campaign[]>([]);
  const [drafts, setDrafts]           = useState<Draft[]>([]);
  const [context, setContext]         = useState<AdsContext | null>(null);
  const [variations, setVariations]   = useState<AiVariation[]>([]);
  const [loading, setLoading]         = useState(false);
  const [syncing, setSyncing]         = useState(false);
  const [generating, setGenerating]   = useState(false);
  const [error, setError]             = useState('');
  const [expandedDraft, setExpandedDraft] = useState<string | null>(null);
  const [rejectNote, setRejectNote]   = useState('');
  const [rejectingId, setRejectingId] = useState<string | null>(null);

  // AI generate form
  const [genObjective, setGenObjective] = useState('sales');
  const [genTone, setGenTone]           = useState('engaging');
  const [genCount, setGenCount]         = useState(3);
  const [selectedProducts, setSelectedProducts] = useState<number[]>([]);

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

  const handleGenerate = async () => {
    if (!context) return;
    setGenerating(true);
    setVariations([]);
    setError('');
    try {
      const products = selectedProducts.length
        ? selectedProducts.map((i) => context.top_products[i])
        : context.top_products.slice(0, 3);
      const res = await api('/api/meta/ai/generate', {
        method: 'POST',
        body: JSON.stringify({
          products,
          top_region:  context.top_region,
          promo_code:  context.active_promos[0]?.code,
          objective:   genObjective,
          tone:        genTone,
          count:       genCount,
        }),
      });
      if (res.success) setVariations(res.data);
      else setError(res.error || 'Generation failed');
    } catch { setError('Generation failed'); }
    finally { setGenerating(false); }
  };

  const saveDraft = async (v: AiVariation) => {
    const res = await api('/api/meta/drafts', {
      method: 'POST',
      body: JSON.stringify({
        title:          v.headline || v.body_text.slice(0, 50),
        headline:       v.headline,
        body_text:      v.body_text,
        call_to_action: v.call_to_action,
        ai_generated:   true,
        source_products: selectedProducts.length ? selectedProducts.map((i) => context!.top_products[i]) : [],
        source_context:  { top_region: context?.top_region, promo: context?.active_promos[0] },
      }),
    });
    if (res.success) { await loadDrafts(); setTab('drafts'); }
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

  // Aggregate campaign stats
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

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={DollarSign} label="Total Spend"    value={fmt(totals.spend)}           color="bg-blue-50 text-blue-600" />
        <StatCard icon={Eye}        label="Impressions"    value={fmtNum(totals.impressions)}   color="bg-purple-50 text-purple-600" />
        <StatCard icon={MousePointer} label="Clicks"       value={fmtNum(totals.clicks)}        sub={`${avgCtr}% CTR`} color="bg-green-50 text-green-600" />
        <StatCard icon={Users}      label="Reach"          value={fmtNum(totals.reach)}          color="bg-orange-50 text-orange-600" />
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
            {t === 'drafts' && drafts.filter((d) => d.status === 'draft').length > 0 && (
              <span className="ml-2 bg-blue-100 text-blue-700 text-xs px-1.5 py-0.5 rounded-full">
                {drafts.filter((d) => d.status === 'draft').length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Campaigns tab ────────────────────────────────────────────────────── */}
      {tab === 'campaigns' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {loading ? (
            <div className="py-12 text-center text-gray-500 text-sm">Loading campaigns…</div>
          ) : campaigns.length === 0 ? (
            <div className="py-12 text-center text-gray-500 text-sm">
              No campaigns cached. Click <strong>Sync Campaigns</strong> to fetch from Meta.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    {['Campaign', 'Status', 'Daily Budget', 'Spend', 'Impressions', 'Clicks', 'CTR'].map((h) => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {campaigns.map((c) => (
                    <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-medium text-gray-900 max-w-[200px] truncate">{c.name}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLOR[c.status] || 'bg-gray-100 text-gray-700'}`}>
                          {c.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-700">{c.daily_budget ? fmt(c.daily_budget) : '—'}</td>
                      <td className="px-4 py-3 text-gray-700">{fmt(c.spend)}</td>
                      <td className="px-4 py-3 text-gray-700">{fmtNum(c.impressions)}</td>
                      <td className="px-4 py-3 text-gray-700">{fmtNum(c.clicks)}</td>
                      <td className="px-4 py-3 text-gray-700">{Number(c.ctr || 0).toFixed(2)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
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
                  <div className="flex items-center gap-3">
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLOR[d.status] || 'bg-gray-100'}`}>
                      {d.status}
                    </span>
                    {expandedDraft === d.id ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                  </div>
                </div>

                {expandedDraft === d.id && (
                  <div className="border-t border-gray-100 px-5 py-4 space-y-4">
                    {d.headline && <p className="font-semibold text-gray-900">{d.headline}</p>}
                    <p className="text-gray-700 text-sm leading-relaxed">{d.body_text}</p>

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
                      <div className="flex items-center gap-2 text-green-700 text-sm">
                        <CheckCircle className="w-4 h-4" /> Approved — ready for publishing
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
        <div className="grid lg:grid-cols-2 gap-6">
          {/* Controls */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-5">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-purple-600" />
              <h2 className="font-semibold text-gray-900">Generate Ad Content</h2>
            </div>

            {context && context.top_products.length > 0 && (
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  Select Products (leave empty for top 3)
                </label>
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {context.top_products.map((p, i) => (
                    <label key={i} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 px-2 py-1 rounded">
                      <input
                        type="checkbox"
                        checked={selectedProducts.includes(i)}
                        onChange={(e) =>
                          setSelectedProducts(e.target.checked
                            ? [...selectedProducts, i]
                            : selectedProducts.filter((x) => x !== i))
                        }
                        className="rounded border-gray-300"
                      />
                      <span className="text-gray-700 truncate">{p.name}</span>
                      <span className="text-gray-400 ml-auto shrink-0">{fmt(p.price)}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

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
                type="number"
                min={1}
                max={5}
                value={genCount}
                onChange={(e) => setGenCount(Number(e.target.value))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {context?.top_region && (
              <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
                Top buying region: <strong>{context.top_region}</strong> — will be included in AI context
              </p>
            )}

            {context?.active_promos[0] && (
              <p className="text-xs text-gray-500 bg-blue-50 rounded-lg px-3 py-2">
                Active promo: <strong>{context.active_promos[0].code}</strong> — will be included if relevant
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

          {/* Results */}
          <div className="space-y-3">
            {generating && (
              <div className="bg-purple-50 rounded-xl border border-purple-100 py-12 text-center">
                <Sparkles className="w-8 h-8 text-purple-400 mx-auto animate-pulse mb-3" />
                <p className="text-purple-700 text-sm font-medium">Generating ad copy using your JulineMart data…</p>
              </div>
            )}

            {!generating && variations.length === 0 && (
              <div className="bg-gray-50 rounded-xl border border-gray-200 py-12 text-center text-gray-500 text-sm">
                Generated variations will appear here
              </div>
            )}

            {variations.map((v, i) => (
              <div key={i} className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-purple-600 uppercase tracking-wide flex items-center gap-1">
                    <Sparkles className="w-3.5 h-3.5" /> Variation {i + 1}
                  </span>
                  <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">{v.call_to_action}</span>
                </div>
                <p className="font-semibold text-gray-900">{v.headline}</p>
                <p className="text-gray-700 text-sm leading-relaxed">{v.body_text}</p>
                <button
                  onClick={() => saveDraft(v)}
                  className="flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors"
                >
                  <Plus className="w-4 h-4" /> Save as Draft
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
