import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle, Loader, Pause, Play, RefreshCw, Sparkles, XCircle } from 'lucide-react';
import { useNotification } from '../../contexts/NotificationContext';
import { PullToRefresh } from '../PullToRefresh';
import { Sheet } from '../Sheet';
import { TABBAR_SPACE } from '../lib/functionsAuth';
import { fmtNgn, marketingApi } from '../lib/marketingApi';

interface Campaign {
  id: string;
  meta_campaign_id: string;
  name: string;
  status: string;
  daily_budget: number | null;
  impressions: number;
  clicks: number;
  spend: number;
  ctr: number;
}

interface Draft {
  id: string;
  title: string;
  headline: string;
  body_text: string;
  status: string;
  suggested_budget: number | null;
  created_at: string;
}

const STATUS_CLS: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-700',
  PAUSED: 'bg-yellow-100 text-yellow-700',
  draft: 'bg-gray-100 text-gray-600',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  published: 'bg-blue-100 text-blue-700',
};

export default function MobileMetaAds() {
  const notification = useNotification();
  const [tab, setTab] = useState<'campaigns' | 'drafts'>('campaigns');
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [selectedDraft, setSelectedDraft] = useState<Draft | null>(null);
  const [acting, setActing] = useState(false);

  const loadCampaigns = useCallback(async () => {
    try {
      const res = await marketingApi<{ success?: boolean; data?: Campaign[]; error?: string }>('/api/meta/campaigns');
      if (res.success) setCampaigns(res.data || []);
      else notification.error('Load failed', res.error || 'Unable to load Meta campaigns');
    } catch (err) {
      notification.error('Load failed', err instanceof Error ? err.message : 'Unable to load Meta campaigns');
    }
  }, [notification]);

  const loadDrafts = useCallback(async () => {
    try {
      const res = await marketingApi<{ success?: boolean; data?: Draft[]; error?: string }>('/api/meta/drafts');
      if (res.success) setDrafts(res.data || []);
      else notification.error('Load failed', res.error || 'Unable to load Meta drafts');
    } catch (err) {
      notification.error('Load failed', err instanceof Error ? err.message : 'Unable to load Meta drafts');
    }
  }, [notification]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([loadCampaigns(), loadDrafts()]);
    } finally {
      setLoading(false);
    }
  }, [loadCampaigns, loadDrafts]);

  useEffect(() => {
    load();
  }, [load]);

  const totals = useMemo(
    () => ({
      spend: campaigns.reduce((s, c) => s + Number(c.spend || 0), 0),
      clicks: campaigns.reduce((s, c) => s + Number(c.clicks || 0), 0),
      impressions: campaigns.reduce((s, c) => s + Number(c.impressions || 0), 0),
    }),
    [campaigns],
  );

  const sync = async () => {
    setSyncing(true);
    const res = await marketingApi<{ success?: boolean; error?: string }>('/api/meta/campaigns/sync', { method: 'POST' });
    setSyncing(false);
    if (res.success) {
      notification.success('Synced', 'Meta campaigns updated');
      loadCampaigns();
    } else notification.error('Sync failed', res.error || 'Unable to sync');
  };

  const toggleCampaign = async (metaId: string, status: 'ACTIVE' | 'PAUSED') => {
    await marketingApi(`/api/meta/campaigns/${metaId}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    });
    loadCampaigns();
  };

  const draftAction = async (action: 'approve' | 'reject' | 'publish', draft: Draft, note?: string) => {
    setActing(true);
    try {
      if (action === 'approve') {
        const res = await marketingApi<{ success?: boolean; error?: string }>(`/api/meta/drafts/${draft.id}/approve`, { method: 'PUT' });
        if (!res.success) throw new Error(res.error);
      } else if (action === 'reject') {
        const res = await marketingApi<{ success?: boolean; error?: string }>(`/api/meta/drafts/${draft.id}/reject`, {
          method: 'PUT',
          body: JSON.stringify({ rejection_note: note || '' }),
        });
        if (!res.success) throw new Error(res.error);
      } else {
        const res = await marketingApi<{ success?: boolean; error?: string }>(`/api/meta/drafts/${draft.id}/publish`, {
          method: 'POST',
          body: JSON.stringify({ daily_budget: draft.suggested_budget || 4000 }),
        });
        if (!res.success) throw new Error(res.error);
        await marketingApi('/api/meta/campaigns/sync', { method: 'POST' });
      }
      notification.success('Updated', `Draft ${action}d`);
      setSelectedDraft(null);
      loadDrafts();
      loadCampaigns();
    } catch (err) {
      notification.error('Action failed', err instanceof Error ? err.message : 'Unable to update draft');
    } finally {
      setActing(false);
    }
  };

  return (
    <>
      <PullToRefresh onRefresh={load}>
        <div className="space-y-3 p-4" style={{ paddingBottom: TABBAR_SPACE }}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <h1 className="text-lg font-bold text-gray-900">Meta Ads</h1>
              <p className="text-xs text-gray-500">Facebook & Instagram campaigns</p>
            </div>
            <button type="button" disabled={syncing} onClick={() => void sync()} className="flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-2 text-xs font-semibold">
              <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} /> Sync
            </button>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl bg-white p-2.5 ring-1 ring-gray-100">
              <p className="text-[10px] text-gray-400">Spend</p>
              <p className="text-sm font-bold">{fmtNgn(totals.spend)}</p>
            </div>
            <div className="rounded-xl bg-white p-2.5 ring-1 ring-gray-100">
              <p className="text-[10px] text-gray-400">Clicks</p>
              <p className="text-sm font-bold">{totals.clicks.toLocaleString()}</p>
            </div>
            <div className="rounded-xl bg-white p-2.5 ring-1 ring-gray-100">
              <p className="text-[10px] text-gray-400">Impressions</p>
              <p className="text-sm font-bold">{totals.impressions.toLocaleString()}</p>
            </div>
          </div>

          <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4">
            {(['campaigns', 'drafts'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`whitespace-nowrap rounded-full border px-3 py-2 text-[11px] font-medium ${
                  tab === t ? 'border-primary-600 bg-primary-600 text-white' : 'border-gray-200 bg-white text-gray-600'
                }`}
              >
                {t === 'campaigns' ? `Campaigns (${campaigns.length})` : `Drafts (${drafts.length})`}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <Loader className="h-6 w-6 animate-spin text-primary-600" />
            </div>
          ) : tab === 'campaigns' ? (
            campaigns.length === 0 ? (
              <div className="rounded-xl bg-white p-4 text-sm text-gray-500 ring-1 ring-gray-100">No Meta campaigns synced yet.</div>
            ) : (
              <div className="space-y-2">
                {campaigns.map((c) => (
                  <div key={c.id} className="rounded-xl bg-white p-3 ring-1 ring-gray-100">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{c.name}</p>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_CLS[c.status] || 'bg-gray-100'}`}>{c.status}</span>
                        <p className="mt-1 text-xs text-gray-500">
                          {fmtNgn(c.spend)} spent · {Number(c.ctr || 0).toFixed(2)}% CTR
                        </p>
                        {c.daily_budget != null && <p className="text-xs text-gray-400">Budget {fmtNgn(c.daily_budget)}/day</p>}
                      </div>
                      <button
                        type="button"
                        onClick={() => void toggleCampaign(c.meta_campaign_id, c.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE')}
                        className="rounded-lg border border-gray-200 p-2"
                      >
                        {c.status === 'ACTIVE' ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 text-green-600" />}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : drafts.length === 0 ? (
            <div className="rounded-xl bg-white p-4 text-sm text-gray-500 ring-1 ring-gray-100">
              <Sparkles className="mb-2 h-5 w-5 text-gray-300" />
              No ad drafts. Use desktop for AI generate & creator tools.
            </div>
          ) : (
            <div className="space-y-2">
              {drafts.map((d) => (
                <button key={d.id} type="button" onClick={() => setSelectedDraft(d)} className="w-full rounded-xl bg-white p-3 text-left ring-1 ring-gray-100">
                  <p className="text-sm font-semibold">{d.title || d.headline}</p>
                  <p className="line-clamp-2 text-xs text-gray-500">{d.body_text}</p>
                  <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_CLS[d.status]}`}>{d.status}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </PullToRefresh>

      <Sheet open={!!selectedDraft} onClose={() => setSelectedDraft(null)} ariaLabel="Meta draft">
        {selectedDraft && (
          <>
            <h3 className="text-base font-bold">{selectedDraft.title || selectedDraft.headline}</h3>
            <p className="text-sm font-medium text-gray-800">{selectedDraft.headline}</p>
            <p className="text-sm text-gray-600">{selectedDraft.body_text}</p>
            {selectedDraft.suggested_budget != null && (
              <p className="text-xs text-gray-500">Suggested budget {fmtNgn(selectedDraft.suggested_budget)}/day</p>
            )}
            {selectedDraft.status === 'draft' && (
              <div className="flex gap-2">
                <button type="button" disabled={acting} onClick={() => void draftAction('approve', selectedDraft)} className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-green-600 py-2.5 text-sm font-semibold text-white">
                  <CheckCircle className="h-4 w-4" /> Approve
                </button>
                <button type="button" disabled={acting} onClick={() => void draftAction('reject', selectedDraft)} className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-red-200 py-2.5 text-sm font-semibold text-red-600">
                  <XCircle className="h-4 w-4" /> Reject
                </button>
              </div>
            )}
            {selectedDraft.status === 'approved' && (
              <button type="button" disabled={acting} onClick={() => void draftAction('publish', selectedDraft)} className="w-full rounded-xl bg-primary-600 py-3 text-sm font-semibold text-white disabled:opacity-60">
                {acting ? 'Publishing…' : 'Publish to Meta'}
              </button>
            )}
          </>
        )}
      </Sheet>
    </>
  );
}
