import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle, Loader, Pause, Play, RefreshCw, XCircle } from 'lucide-react';
import { useNotification } from '../../contexts/NotificationContext';
import { PullToRefresh } from '../PullToRefresh';
import { Sheet } from '../Sheet';
import { TABBAR_SPACE } from '../lib/functionsAuth';
import { fmtNgn, marketingApi } from '../lib/marketingApi';

type AccountKey = 'julinemart' | 'services' | 'skolahq';

interface GoogleCampaign {
  id: string;
  google_campaign_id: string;
  account_key: AccountKey;
  name: string;
  status: string;
  campaign_type: string;
  budget_amount_micros: number;
  impressions: number;
  clicks: number;
  cost_micros: number;
  ctr: number;
}

interface GoogleDraft {
  id: string;
  account_key: AccountKey;
  title: string;
  headlines: string[];
  descriptions: string[];
  status: string;
  suggested_budget_ngn: number | null;
  campaign_type: string;
  created_at: string;
}

const ACCOUNTS: { key: AccountKey; label: string }[] = [
  { key: 'julinemart', label: 'JulineMart' },
  { key: 'services', label: 'Services' },
  { key: 'skolahq', label: 'SkolaHQ' },
];

const microToNgn = (micros: number) => micros / 1_000_000;

const STATUS_CLS: Record<string, string> = {
  ENABLED: 'bg-green-100 text-green-700',
  PAUSED: 'bg-yellow-100 text-yellow-700',
  draft: 'bg-gray-100 text-gray-600',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  published: 'bg-blue-100 text-blue-700',
};

export default function MobileGoogleAds() {
  const notification = useNotification();
  const [account, setAccount] = useState<AccountKey>('julinemart');
  const [tab, setTab] = useState<'campaigns' | 'drafts'>('campaigns');
  const [campaigns, setCampaigns] = useState<GoogleCampaign[]>([]);
  const [drafts, setDrafts] = useState<GoogleDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [selectedDraft, setSelectedDraft] = useState<GoogleDraft | null>(null);
  const [acting, setActing] = useState(false);

  const loadCampaigns = useCallback(async () => {
    try {
      const res = await marketingApi<{ success?: boolean; data?: GoogleCampaign[]; error?: string }>(
        `/api/google/campaigns?account=${account}`,
      );
      if (res.success) setCampaigns(res.data || []);
      else notification.error('Load failed', res.error || 'Unable to load Google campaigns');
    } catch (err) {
      notification.error('Load failed', err instanceof Error ? err.message : 'Unable to load Google campaigns');
    }
  }, [account, notification]);

  const loadDrafts = useCallback(async () => {
    try {
      const res = await marketingApi<{ success?: boolean; data?: GoogleDraft[]; error?: string }>(
        `/api/google/drafts?account=${account}`,
      );
      if (res.success) setDrafts(res.data || []);
      else notification.error('Load failed', res.error || 'Unable to load Google drafts');
    } catch (err) {
      notification.error('Load failed', err instanceof Error ? err.message : 'Unable to load Google drafts');
    }
  }, [account, notification]);

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
      spend: campaigns.reduce((s, c) => s + microToNgn(c.cost_micros || 0), 0),
      clicks: campaigns.reduce((s, c) => s + Number(c.clicks || 0), 0),
    }),
    [campaigns],
  );

  const sync = async () => {
    setSyncing(true);
    const res = await marketingApi<{ success?: boolean; error?: string }>('/api/google/campaigns/sync', {
      method: 'POST',
      body: JSON.stringify({ account }),
    });
    setSyncing(false);
    if (res.success) {
      notification.success('Synced', 'Google campaigns updated');
      loadCampaigns();
    } else notification.error('Sync failed', res.error || 'Unable to sync');
  };

  const toggleCampaign = async (googleId: string, status: 'ENABLED' | 'PAUSED') => {
    await marketingApi(`/api/google/campaigns/${googleId}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status, account }),
    });
    loadCampaigns();
  };

  const draftAction = async (action: 'approve' | 'reject' | 'publish', draft: GoogleDraft) => {
    setActing(true);
    try {
      if (action === 'approve') {
        const res = await marketingApi<{ success?: boolean; error?: string }>(`/api/google/drafts/${draft.id}/approve`, { method: 'PUT' });
        if (!res.success) throw new Error(res.error);
      } else if (action === 'reject') {
        const res = await marketingApi<{ success?: boolean; error?: string }>(`/api/google/drafts/${draft.id}/reject`, {
          method: 'PUT',
          body: JSON.stringify({ rejection_note: '' }),
        });
        if (!res.success) throw new Error(res.error);
      } else {
        const res = await marketingApi<{ success?: boolean; error?: string }>(`/api/google/drafts/${draft.id}/publish`, {
          method: 'POST',
          body: JSON.stringify({ account, daily_budget_ngn: draft.suggested_budget_ngn || 1000 }),
        });
        if (!res.success) throw new Error(res.error);
        await marketingApi('/api/google/campaigns/sync', { method: 'POST', body: JSON.stringify({ account }) });
      }
      notification.success('Updated', `Draft ${action}d`);
      setSelectedDraft(null);
      load();
    } catch (err) {
      notification.error('Action failed', err instanceof Error ? err.message : 'Unable to update');
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
              <h1 className="text-lg font-bold text-gray-900">Google Ads</h1>
              <p className="text-xs text-gray-500">Search & display campaigns</p>
            </div>
            <button type="button" disabled={syncing} onClick={() => void sync()} className="flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-2 text-xs font-semibold">
              <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} /> Sync
            </button>
          </div>

          <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4">
            {ACCOUNTS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setAccount(key)}
                className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-[10px] font-medium ${
                  account === key ? 'border-gray-800 bg-gray-800 text-white' : 'border-gray-200 bg-white text-gray-600'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-white p-2.5 ring-1 ring-gray-100">
              <p className="text-[10px] text-gray-400">Spend</p>
              <p className="text-sm font-bold">{fmtNgn(totals.spend)}</p>
            </div>
            <div className="rounded-xl bg-white p-2.5 ring-1 ring-gray-100">
              <p className="text-[10px] text-gray-400">Clicks</p>
              <p className="text-sm font-bold">{totals.clicks.toLocaleString()}</p>
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
              <div className="rounded-xl bg-white p-4 text-sm text-gray-500 ring-1 ring-gray-100">No Google campaigns for this account.</div>
            ) : (
              <div className="space-y-2">
                {campaigns.map((c) => (
                  <div key={c.id} className="rounded-xl bg-white p-3 ring-1 ring-gray-100">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{c.name}</p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_CLS[c.status]}`}>{c.status}</span>
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600">{c.campaign_type}</span>
                        </div>
                        <p className="mt-1 text-xs text-gray-500">
                          {fmtNgn(microToNgn(c.cost_micros))} · {Number(c.ctr || 0).toFixed(2)}% CTR
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void toggleCampaign(c.google_campaign_id, c.status === 'ENABLED' ? 'PAUSED' : 'ENABLED')}
                        className="rounded-lg border border-gray-200 p-2"
                      >
                        {c.status === 'ENABLED' ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 text-green-600" />}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : drafts.length === 0 ? (
            <div className="rounded-xl bg-white p-4 text-sm text-gray-500 ring-1 ring-gray-100">No drafts. AI generate & creator on desktop.</div>
          ) : (
            <div className="space-y-2">
              {drafts.map((d) => (
                <button key={d.id} type="button" onClick={() => setSelectedDraft(d)} className="w-full rounded-xl bg-white p-3 text-left ring-1 ring-gray-100">
                  <p className="text-sm font-semibold">{d.title}</p>
                  <p className="text-xs text-gray-500">{d.headlines?.[0]}</p>
                  <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_CLS[d.status]}`}>{d.status}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </PullToRefresh>

      <Sheet open={!!selectedDraft} onClose={() => setSelectedDraft(null)} ariaLabel="Google draft">
        {selectedDraft && (
          <>
            <h3 className="text-base font-bold">{selectedDraft.title}</h3>
            <p className="text-xs text-gray-500">{selectedDraft.campaign_type}</p>
            {selectedDraft.headlines?.length > 0 && (
              <ul className="list-disc pl-4 text-sm text-gray-700">
                {selectedDraft.headlines.slice(0, 3).map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>
            )}
            {selectedDraft.descriptions?.[0] && <p className="text-sm text-gray-600">{selectedDraft.descriptions[0]}</p>}
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
                {acting ? 'Publishing…' : 'Publish to Google'}
              </button>
            )}
          </>
        )}
      </Sheet>
    </>
  );
}
