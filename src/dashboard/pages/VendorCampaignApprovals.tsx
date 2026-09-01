import { useCallback, useEffect, useState } from 'react';
import { CheckCircle, ExternalLink, Megaphone, XCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useNotification } from '../contexts/NotificationContext';

const functionsBase = import.meta.env.VITE_NETLIFY_FUNCTIONS_BASE || '/.netlify/functions';
const STOREFRONT = (import.meta.env.VITE_STOREFRONT_URL || 'https://julinemart.com').replace(/\/$/, '');

type CampaignRow = {
  id: string;
  slug: string;
  public_title: string;
  approval_status: string | null;
  status: string;
  submitted_via: 'vendor' | 'skola_agent' | null;
  submitted_at: string | null;
  review_notes: string | null;
  grand_prize_description?: string | null;
  hero_config?: { headline?: string; subtitle?: string; heroImageMobile?: string } | null;
  vendors?: { store_name?: string; email?: string; city?: string; state?: string } | null;
};

const STATUS_FILTERS = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'all', label: 'All' },
];

export default function VendorCampaignApprovalsPage() {
  const { session } = useAuth();
  const notification = useNotification();
  const [items, setItems] = useState<CampaignRow[]>([]);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [actioning, setActioning] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
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

  useEffect(() => { load(); }, [load]);

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
      const approvedRow = items.find((r) => r.id === id);
      const autoActivated = approvedRow?.submitted_via === 'vendor';
      notification.success(
        action === 'approve'
          ? autoActivated
            ? 'Campaign approved and live'
            : 'Approved — finish setup (reward voucher, secret code) in Giveaways to publish'
          : 'Campaign rejected'
      );
      setRejectId(null);
      setRejectNotes('');
      load();
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActioning(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Megaphone className="h-6 w-6 text-primary-600" />
          Campaign submissions
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Review seller-created promotion pages and Skola AI-proposed giveaways before they go live.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setStatusFilter(f.key)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${
              statusFilter === f.key ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-700'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-gray-500">No vendor campaigns in this queue.</p>
      ) : (
        <div className="space-y-4">
          {items.map((row) => (
            <div key={row.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-gray-900">{row.public_title}</p>
                  <p className="text-sm text-gray-500">
                    {row.submitted_via === 'skola_agent' ? (
                      <span className="inline-flex items-center gap-1 font-medium text-purple-700">🤖 Skola AI proposal</span>
                    ) : (
                      <>{row.vendors?.store_name || 'Vendor'} · {row.vendors?.city || row.vendors?.state || '—'}</>
                    )}
                  </p>
                  {row.submitted_via === 'skola_agent' && row.grand_prize_description && (
                    <p className="text-xs text-gray-500 mt-0.5">Prize: {row.grand_prize_description}</p>
                  )}
                  <p className="text-xs text-gray-400 mt-1">
                    <a
                      href={`${STOREFRONT}/campaigns/${row.slug}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-primary-600 hover:underline"
                    >
                      Preview slug: {row.slug} <ExternalLink className="h-3 w-3" />
                    </a>
                  </p>
                  {row.hero_config?.headline && (
                    <p className="text-sm text-gray-600 mt-2">{row.hero_config.headline}</p>
                  )}
                </div>
                <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-700">
                  {row.approval_status || 'draft'}
                </span>
              </div>

              {row.approval_status === 'pending' && (
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={actioning === row.id}
                    onClick={() => runAction(row.id, 'approve')}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    <CheckCircle className="h-4 w-4" />
                    {row.submitted_via === 'skola_agent' ? 'Approve (finish setup after)' : 'Approve & publish'}
                  </button>
                  <button
                    type="button"
                    disabled={actioning === row.id}
                    onClick={() => setRejectId(row.id)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-700"
                  >
                    <XCircle className="h-4 w-4" /> Reject
                  </button>
                </div>
              )}

              {row.approval_status === 'approved' && row.submitted_via === 'skola_agent' && row.status !== 'active' && (
                <div className="mt-3 rounded-lg border border-purple-100 bg-purple-50 p-3 text-sm text-purple-800">
                  Approved but not live yet — go to{' '}
                  <a href="/admin/giveaways" className="font-semibold underline">
                    Giveaways
                  </a>{' '}
                  to attach the reward voucher(s), confirm the secret code, and activate it.
                </div>
              )}

              {rejectId === row.id && (
                <div className="mt-3 space-y-2 rounded-lg border border-red-100 bg-red-50 p-3">
                  <textarea
                    value={rejectNotes}
                    onChange={(e) => setRejectNotes(e.target.value)}
                    placeholder="Tell the seller what to fix…"
                    rows={2}
                    className="w-full rounded-lg border border-red-200 px-3 py-2 text-sm"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => runAction(row.id, 'reject', rejectNotes)}
                      className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white"
                    >
                      Confirm reject
                    </button>
                    <button type="button" onClick={() => setRejectId(null)} className="text-sm text-gray-600">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
