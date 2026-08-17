import { useCallback, useEffect, useState } from 'react';
import { CheckCircle, Shield, XCircle } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { PullToRefresh } from '../PullToRefresh';
import { Sheet } from '../Sheet';

const functionsBase = import.meta.env.VITE_NETLIFY_FUNCTIONS_BASE || '/.netlify/functions';

type VerificationRow = {
  id: string;
  vendor_id: string;
  verification_type: string;
  status: string;
  created_at: string;
  vendors?: { store_name?: string; email?: string; city?: string; state?: string } | null;
};

const STATUS_FILTERS = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
];

const TYPE_LABELS: Record<string, string> = {
  identity: 'Identity',
  phone: 'Phone',
  bank_account: 'Bank',
  business_registration: 'Business',
  physical_store: 'Store',
  trusted_seller: 'Trusted',
  julinemart_assured: 'Assured',
};

export default function MobileSellerVerifications() {
  const { session } = useAuth();
  const notification = useNotification();
  const [items, setItems] = useState<VerificationRow[]>([]);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [actioning, setActioning] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<VerificationRow | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const load = useCallback(async () => {
    if (!session?.access_token) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ status: statusFilter });
      const res = await fetch(`${functionsBase}/admin-seller-verifications?${params}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || 'Failed to load');
      setItems(payload.data || []);
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [notification, session?.access_token, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const runAction = async (id: string, action: 'approve' | 'reject', reason?: string) => {
    if (!session?.access_token) return;
    setActioning(id);
    try {
      const res = await fetch(`${functionsBase}/admin-seller-verification-approve`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id, action, reject_reason: reason }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || 'Action failed');
      notification.success(action === 'approve' ? 'Approved' : 'Rejected');
      setRejectTarget(null);
      setRejectReason('');
      await load();
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActioning(null);
    }
  };

  return (
    <PullToRefresh onRefresh={load}>
      <div className="px-4 pt-4 pb-24">
        <div className="flex items-center gap-2 mb-1">
          <Shield className="w-5 h-5 text-primary-600" />
          <h1 className="text-lg font-bold text-gray-900">Seller Verifications</h1>
        </div>
        <p className="text-xs text-gray-500 mb-4">Approve trust badges for Nigerian sellers</p>

        <div className="flex gap-2 overflow-x-auto pb-3 -mx-1 px-1">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setStatusFilter(f.key)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold ${
                statusFilter === f.key ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-700'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="py-12 text-center text-sm text-gray-500">Loading…</div>
        ) : items.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-500">No records</div>
        ) : (
          <div className="space-y-3">
            {items.map((row) => (
              <div key={row.id} className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900 truncate">
                      {row.vendors?.store_name || 'Seller'}
                    </p>
                    <p className="text-xs text-primary-700 font-medium mt-0.5">
                      {TYPE_LABELS[row.verification_type] || row.verification_type}
                    </p>
                    <p className="text-[11px] text-gray-500 mt-1 capitalize">{row.status}</p>
                  </div>
                </div>

                {row.status === 'pending' && (
                  <div className="grid grid-cols-2 gap-2 mt-3">
                    <button
                      type="button"
                      disabled={actioning === row.id}
                      onClick={() => runAction(row.id, 'approve')}
                      className="inline-flex items-center justify-center gap-1 rounded-xl bg-green-600 py-2.5 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      <CheckCircle className="w-4 h-4" />
                      Approve
                    </button>
                    <button
                      type="button"
                      disabled={actioning === row.id}
                      onClick={() => setRejectTarget(row)}
                      className="inline-flex items-center justify-center gap-1 rounded-xl bg-red-50 py-2.5 text-xs font-semibold text-red-700 disabled:opacity-50"
                    >
                      <XCircle className="w-4 h-4" />
                      Reject
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <Sheet open={Boolean(rejectTarget)} onClose={() => setRejectTarget(null)} ariaLabel="Reject verification">
        <textarea
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          placeholder="Reason (optional)"
          className="w-full border rounded-xl p-3 text-sm min-h-[88px] mb-3"
        />
        <button
          type="button"
          onClick={() => rejectTarget && runAction(rejectTarget.id, 'reject', rejectReason)}
          className="w-full py-3 rounded-xl bg-red-600 text-white text-sm font-semibold"
        >
          Confirm reject
        </button>
      </Sheet>
    </PullToRefresh>
  );
}
