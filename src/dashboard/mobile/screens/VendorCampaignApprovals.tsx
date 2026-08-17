import { useCallback, useEffect, useState } from 'react';
import { CheckCircle, ChevronRight, ExternalLink, Loader, Megaphone, XCircle } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { PullToRefresh } from '../PullToRefresh';
import { Sheet } from '../Sheet';
import { TABBAR_SPACE, functionsBase } from '../lib/functionsAuth';

const STOREFRONT = (import.meta.env.VITE_STOREFRONT_URL || 'https://julinemart.com').replace(/\/$/, '');

type CampaignRow = {
  id: string;
  slug: string;
  public_title: string;
  approval_status: string | null;
  status: string;
  submitted_at: string | null;
  review_notes: string | null;
  hero_config?: { headline?: string; subtitle?: string; heroImageMobile?: string } | null;
  vendors?: { store_name?: string; email?: string; city?: string; state?: string } | null;
};

const STATUS_FILTERS = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'all', label: 'All' },
];

export default function MobileVendorCampaignApprovals() {
  const { session } = useAuth();
  const notification = useNotification();
  const [items, setItems] = useState<CampaignRow[]>([]);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [actioning, setActioning] = useState<string | null>(null);
  const [selected, setSelected] = useState<CampaignRow | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [rejectNotes, setRejectNotes] = useState('');

  const load = useCallback(async () => {
    if (!session?.access_token) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ status: statusFilter });
      const res = await fetch(`${functionsBase}/admin-vendor-campaigns?${params}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || 'Failed to load campaigns');
      setItems(payload.data || []);
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [notification, session?.access_token, statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const runAction = async (id: string, action: 'approve' | 'reject', notes?: string) => {
    if (!session?.access_token) return;
    setActioning(id);
    try {
      const res = await fetch(`${functionsBase}/admin-vendor-campaigns`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id, action, review_notes: notes }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || 'Action failed');
      notification.success(action === 'approve' ? 'Campaign approved and live' : 'Campaign rejected');
      setSelected(null);
      setRejecting(false);
      setRejectNotes('');
      await load();
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActioning(null);
    }
  };

  return (
    <>
      <PullToRefresh onRefresh={load}>
        <div style={{ paddingBottom: TABBAR_SPACE }}>
          <div className="sticky top-0 z-10 bg-gray-50 px-4 pb-3 pt-3">
            <div className="mb-3 flex items-center gap-2">
              <Megaphone className="h-5 w-5 text-primary-600" />
              <h1 className="text-lg font-bold text-gray-900">Vendor Campaigns</h1>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setStatusFilter(f.key)}
                  className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${
                    statusFilter === f.key ? 'bg-primary-600 text-white' : 'bg-white text-gray-600 ring-1 ring-gray-200'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2 px-4 pt-1">
            {loading ? (
              <div className="flex justify-center py-16">
                <Loader className="h-7 w-7 animate-spin text-primary-600" />
              </div>
            ) : items.length === 0 ? (
              <div className="rounded-2xl bg-white px-6 py-12 text-center ring-1 ring-gray-100">
                <Megaphone className="mx-auto mb-3 h-10 w-10 text-gray-300" />
                <p className="font-semibold text-gray-900">No campaigns in this queue</p>
              </div>
            ) : (
              items.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => setSelected(row)}
                  className="flex w-full items-start gap-3 rounded-2xl bg-white p-3.5 text-left ring-1 ring-gray-100 active:bg-gray-50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="truncate font-semibold text-gray-900">{row.public_title}</p>
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-700">
                        {row.approval_status || 'draft'}
                      </span>
                    </div>
                    <p className="truncate text-xs text-gray-500">
                      {row.vendors?.store_name || 'Vendor'} · {row.vendors?.city || row.vendors?.state || '—'}
                    </p>
                    {row.hero_config?.headline && (
                      <p className="mt-0.5 truncate text-xs text-gray-400">{row.hero_config.headline}</p>
                    )}
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-gray-300" />
                </button>
              ))
            )}
          </div>
        </div>
      </PullToRefresh>

      <Sheet
        open={!!selected}
        onClose={() => {
          setSelected(null);
          setRejecting(false);
          setRejectNotes('');
        }}
        ariaLabel="Campaign details"
      >
        {selected && (
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-lg font-bold text-gray-900">{selected.public_title}</h2>
                <p className="text-sm text-gray-500">
                  {selected.vendors?.store_name || 'Vendor'} · {selected.vendors?.city || selected.vendors?.state || '—'}
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-700">
                {selected.approval_status || 'draft'}
              </span>
            </div>

            {selected.hero_config?.headline && (
              <p className="rounded-2xl bg-gray-50 p-3.5 text-sm text-gray-700 ring-1 ring-gray-100">
                {selected.hero_config.headline}
              </p>
            )}

            <a
              href={`${STOREFRONT}/campaigns/${selected.slug}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm text-primary-600 underline"
            >
              Preview: {selected.slug} <ExternalLink className="h-3.5 w-3.5" />
            </a>

            {selected.approval_status === 'pending' && !rejecting && (
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={actioning === selected.id}
                  onClick={() => runAction(selected.id, 'approve')}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl bg-green-600 py-3 text-sm font-semibold text-white disabled:opacity-60"
                >
                  <CheckCircle className="h-4 w-4" /> Approve
                </button>
                <button
                  type="button"
                  disabled={actioning === selected.id}
                  onClick={() => setRejecting(true)}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl border border-red-200 py-3 text-sm font-semibold text-red-700"
                >
                  <XCircle className="h-4 w-4" /> Reject
                </button>
              </div>
            )}

            {rejecting && (
              <div className="space-y-2 rounded-2xl bg-red-50 p-3.5 ring-1 ring-red-100">
                <textarea
                  value={rejectNotes}
                  onChange={(e) => setRejectNotes(e.target.value)}
                  placeholder="Tell the seller what to fix…"
                  rows={3}
                  className="w-full rounded-xl border border-red-200 px-3 py-2 text-sm"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={actioning === selected.id}
                    onClick={() => runAction(selected.id, 'reject', rejectNotes)}
                    className="flex-1 rounded-xl bg-red-600 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    Confirm reject
                  </button>
                  <button
                    type="button"
                    onClick={() => setRejecting(false)}
                    className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-semibold text-gray-600"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </Sheet>
    </>
  );
}
