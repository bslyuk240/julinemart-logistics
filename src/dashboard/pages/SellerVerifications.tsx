import { useCallback, useEffect, useState } from 'react';
import { BadgeCheck, CheckCircle, RefreshCw, Shield, XCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useNotification } from '../contexts/NotificationContext';

const functionsBase = import.meta.env.VITE_NETLIFY_FUNCTIONS_BASE || '/.netlify/functions';

type VerificationRow = {
  id: string;
  vendor_id: string;
  verification_type: string;
  status: string;
  evidence: Record<string, unknown>;
  reject_reason: string | null;
  created_at: string;
  vendors?: { store_name?: string; email?: string; city?: string; state?: string } | null;
};

const STATUS_FILTERS = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'all', label: 'All' },
];

const TYPE_LABELS: Record<string, string> = {
  identity: 'Identity',
  phone: 'Phone',
  bank_account: 'Bank account',
  business_registration: 'Business registration',
  physical_store: 'Physical store',
  trusted_seller: 'Trusted seller',
  julinemart_assured: 'JulineMart Assured',
};

export default function SellerVerificationsPage() {
  const { session } = useAuth();
  const notification = useNotification();
  const [items, setItems] = useState<VerificationRow[]>([]);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [actioning, setActioning] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
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
      if (!res.ok) throw new Error(payload?.error || 'Failed to load verifications');
      setItems(payload.data || []);
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Failed to load verifications');
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
      notification.success(action === 'approve' ? 'Verification approved' : 'Verification rejected');
      setRejectId(null);
      setRejectReason('');
      await load();
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActioning(null);
    }
  };

  const recomputeMetrics = async () => {
    if (!session?.access_token) return;
    try {
      const res = await fetch(`${functionsBase}/compute-seller-metrics`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || 'Metrics job failed');
      notification.success(`Updated metrics for ${payload.updated ?? 0} vendors`);
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Metrics job failed');
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Shield className="w-7 h-7 text-primary-600" />
            Seller Verifications
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            Review identity, business, and store verification requests for Trusted Local Commerce.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm hover:bg-gray-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            type="button"
            onClick={recomputeMetrics}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-primary-600 text-white text-sm hover:bg-primary-700"
          >
            <BadgeCheck className="w-4 h-4" />
            Recompute metrics
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setStatusFilter(f.key)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium ${
              statusFilter === f.key
                ? 'bg-primary-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-600">
              <tr>
                <th className="px-4 py-3 font-medium">Seller</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Submitted</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500">Loading…</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500">No verification records</td></tr>
              ) : (
                items.map((row) => (
                  <tr key={row.id} className="border-t">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{row.vendors?.store_name || row.vendor_id.slice(0, 8)}</div>
                      <div className="text-xs text-gray-500">{row.vendors?.email}</div>
                      {(row.vendors?.city || row.vendors?.state) && (
                        <div className="text-xs text-gray-400">{[row.vendors?.city, row.vendors?.state].filter(Boolean).join(', ')}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">{TYPE_LABELS[row.verification_type] || row.verification_type}</td>
                    <td className="px-4 py-3 capitalize">{row.status}</td>
                    <td className="px-4 py-3 text-gray-500">{new Date(row.created_at).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      {row.status === 'pending' ? (
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            disabled={actioning === row.id}
                            onClick={() => runAction(row.id, 'approve')}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-green-600 text-white text-xs hover:bg-green-700 disabled:opacity-50"
                          >
                            <CheckCircle className="w-3.5 h-3.5" />
                            Approve
                          </button>
                          <button
                            type="button"
                            disabled={actioning === row.id}
                            onClick={() => setRejectId(row.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-red-50 text-red-700 text-xs hover:bg-red-100 disabled:opacity-50"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            Reject
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {rejectId && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-5 shadow-xl">
            <h3 className="font-semibold text-gray-900 mb-2">Reject verification</h3>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Reason for rejection (optional)"
              className="w-full border rounded-lg p-3 text-sm min-h-[96px]"
            />
            <div className="flex gap-2 mt-4">
              <button
                type="button"
                onClick={() => { setRejectId(null); setRejectReason(''); }}
                className="flex-1 py-2.5 rounded-lg border text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => runAction(rejectId, 'reject', rejectReason)}
                className="flex-1 py-2.5 rounded-lg bg-red-600 text-white text-sm"
              >
                Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
