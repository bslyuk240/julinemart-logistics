import { useCallback, useEffect, useState } from 'react';
import { Bike, CheckCircle, RefreshCw, ExternalLink, XCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useNotification } from '../contexts/NotificationContext';

const functionsBase = import.meta.env.VITE_NETLIFY_FUNCTIONS_BASE || '/.netlify/functions';

type RiderRow = {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  nin: string;
  id_document_url: string | null;
  selfie_url: string | null;
  selfie_captured_at: string | null;
  vehicle_type: string;
  vehicle_plate: string;
  vehicle_document_url: string | null;
  guarantor_name: string;
  guarantor_phone: string;
  bank_name: string | null;
  bank_account_number: string | null;
  bank_account_name: string | null;
  status: string;
  reject_reason: string | null;
  approved_at: string | null;
  created_at: string;
  approved_vendor_locations?: { city: string; state: string } | null;
};

const STATUS_FILTERS = [
  { key: 'pending_review', label: 'Pending' },
  { key: 'active', label: 'Active' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'suspended', label: 'Suspended' },
  { key: 'all', label: 'All' },
];

const STATUS_BADGE: Record<string, string> = {
  active: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-700',
  pending_review: 'bg-amber-100 text-amber-800',
  suspended: 'bg-gray-100 text-gray-600',
};

export default function RiderVerificationsPage() {
  const { session } = useAuth();
  const notification = useNotification();
  const [rows, setRows] = useState<RiderRow[]>([]);
  const [statusFilter, setStatusFilter] = useState('pending_review');
  const [loading, setLoading] = useState(true);
  const [actioning, setActioning] = useState<string | null>(null);
  const [selected, setSelected] = useState<RiderRow | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const load = useCallback(async () => {
    if (!session?.access_token) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ status: statusFilter });
      const res = await fetch(`${functionsBase}/admin-rider-verifications?${params}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || 'Failed to load applications');
      setRows(payload.data || []);
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Failed to load applications');
    } finally {
      setLoading(false);
    }
  }, [notification, session?.access_token, statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const runAction = async (riderId: string, action: 'approve' | 'reject', reason?: string) => {
    if (!session?.access_token) return;
    setActioning(riderId);
    try {
      const res = await fetch(`${functionsBase}/rider-approve`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ rider_id: riderId, action, reject_reason: reason }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || 'Action failed');
      notification.success(action === 'approve' ? 'Rider approved' : 'Application rejected');
      setSelected(null);
      setRejecting(false);
      setRejectReason('');
      await load();
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActioning(null);
    }
  };

  return (
    <div className="w-full max-w-none px-4 sm:px-6 xl:px-8 py-4 md:py-6">
      <div className="flex items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <Bike className="w-8 h-8 text-primary-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Rider Verifications</h1>
            <p className="text-sm text-gray-600">Review rider KYC applications before they can go online.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={load}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm hover:bg-gray-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setStatusFilter(f.key)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium ${
              statusFilter === f.key ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
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
                <th className="px-4 py-3 font-medium">Rider</th>
                <th className="px-4 py-3 font-medium">Vehicle</th>
                <th className="px-4 py-3 font-medium">Area</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Submitted</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">No applications in this filter</td></tr>
              ) : (
                rows.map((row) => (
                  <tr
                    key={row.id}
                    onClick={() => setSelected(row)}
                    className="border-t cursor-pointer hover:bg-gray-50"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{row.full_name}</div>
                      <div className="text-xs text-gray-500">{row.email} · {row.phone}</div>
                    </td>
                    <td className="px-4 py-3 capitalize">{row.vehicle_type} · {row.vehicle_plate}</td>
                    <td className="px-4 py-3 text-gray-500">
                      {row.approved_vendor_locations
                        ? `${row.approved_vendor_locations.city}, ${row.approved_vendor_locations.state}`
                        : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[row.status] || 'bg-gray-100 text-gray-600'}`}>
                        {row.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{new Date(row.created_at).toLocaleDateString()}</td>
                    <td className="px-4 py-3">
                      {row.status === 'pending_review' ? (
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            disabled={actioning === row.id}
                            onClick={(e) => { e.stopPropagation(); runAction(row.id, 'approve'); }}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-green-600 text-white text-xs hover:bg-green-700 disabled:opacity-50"
                          >
                            <CheckCircle className="w-3.5 h-3.5" />
                            Approve
                          </button>
                          <button
                            type="button"
                            disabled={actioning === row.id}
                            onClick={(e) => { e.stopPropagation(); setSelected(row); setRejecting(true); }}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-red-50 text-red-700 text-xs hover:bg-red-100 disabled:opacity-50"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            Reject
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400 block text-right">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg p-5 shadow-xl max-h-[88vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h3 className="font-semibold text-gray-900 text-lg">{selected.full_name}</h3>
                <p className="text-xs text-gray-500">{selected.email} · {selected.phone}</p>
              </div>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium shrink-0 ${STATUS_BADGE[selected.status] || 'bg-gray-100 text-gray-600'}`}>
                {selected.status.replace('_', ' ')}
              </span>
            </div>

            <div className="space-y-3 text-sm">
              <DetailRow label="NIN" value={selected.nin} />
              <DetailRow
                label="Vehicle"
                value={`${selected.vehicle_type} · ${selected.vehicle_plate}`}
              />
              <DetailRow
                label="Area"
                value={selected.approved_vendor_locations ? `${selected.approved_vendor_locations.city}, ${selected.approved_vendor_locations.state}` : '—'}
              />
              <DetailRow label="Guarantor" value={`${selected.guarantor_name} · ${selected.guarantor_phone}`} />
              <DetailRow
                label="Payout account"
                value={
                  selected.bank_name
                    ? `${selected.bank_name} · ${selected.bank_account_number} · ${selected.bank_account_name}`
                    : '—'
                }
              />

              <div className="pt-2 border-t">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500 mb-2">Documents</p>
                <div className="flex flex-wrap gap-2">
                  {selected.id_document_url && (
                    <DocLink href={selected.id_document_url} label="ID photo" />
                  )}
                  {selected.selfie_url && <DocLink href={selected.selfie_url} label="Selfie" />}
                  {selected.vehicle_document_url && (
                    <DocLink href={selected.vehicle_document_url} label="Vehicle doc" />
                  )}
                </div>
              </div>

              {selected.reject_reason && (
                <div className="pt-2 border-t">
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-500 mb-1">Reject reason</p>
                  <p className="text-sm text-red-700">{selected.reject_reason}</p>
                </div>
              )}
            </div>

            {selected.status === 'pending_review' && !rejecting && (
              <div className="flex gap-2 mt-5">
                <button
                  type="button"
                  disabled={actioning === selected.id}
                  onClick={() => runAction(selected.id, 'approve')}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 rounded-lg bg-green-600 text-white text-sm font-medium disabled:opacity-50"
                >
                  <CheckCircle className="w-4 h-4" />
                  Approve
                </button>
                <button
                  type="button"
                  disabled={actioning === selected.id}
                  onClick={() => setRejecting(true)}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 rounded-lg bg-red-50 text-red-700 text-sm font-medium disabled:opacity-50"
                >
                  <XCircle className="w-4 h-4" />
                  Reject
                </button>
              </div>
            )}

            {rejecting && (
              <div className="mt-5">
                <textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Reason for rejection (optional)"
                  className="w-full border rounded-lg p-3 text-sm min-h-[96px]"
                />
                <div className="flex gap-2 mt-3">
                  <button
                    type="button"
                    onClick={() => { setRejecting(false); setRejectReason(''); }}
                    className="flex-1 py-2.5 rounded-lg border text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => runAction(selected.id, 'reject', rejectReason)}
                    className="flex-1 py-2.5 rounded-lg bg-red-600 text-white text-sm"
                  >
                    Confirm reject
                  </button>
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={() => { setSelected(null); setRejecting(false); setRejectReason(''); }}
              className="w-full mt-3 py-2 text-sm text-gray-500"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-900 text-right">{value}</span>
    </div>
  );
}

function DocLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-primary-700 hover:bg-primary-50"
    >
      {label}
      <ExternalLink className="w-3 h-3" />
    </a>
  );
}
