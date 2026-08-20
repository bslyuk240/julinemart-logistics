import { useCallback, useEffect, useState } from 'react';
import { Bike, CheckCircle, ExternalLink, XCircle } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { PullToRefresh } from '../PullToRefresh';
import { Sheet } from '../Sheet';

const functionsBase = import.meta.env.VITE_NETLIFY_FUNCTIONS_BASE || '/.netlify/functions';

type RiderRow = {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  nin: string;
  id_document_url: string | null;
  selfie_url: string | null;
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

export default function MobileRiderVerifications() {
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

  const closeSheet = () => {
    setSelected(null);
    setRejecting(false);
    setRejectReason('');
  };

  return (
    <PullToRefresh onRefresh={load}>
      <div className="px-4 pt-4 pb-24">
        <div className="flex items-center gap-2 mb-1">
          <Bike className="w-5 h-5 text-primary-600" />
          <h1 className="text-lg font-bold text-gray-900">Rider Verifications</h1>
        </div>
        <p className="text-xs text-gray-500 mb-4">Review rider KYC applications before they can go online</p>

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
        ) : rows.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-500">No applications in this filter</div>
        ) : (
          <div className="space-y-3">
            {rows.map((row) => (
              <button
                key={row.id}
                type="button"
                onClick={() => setSelected(row)}
                className="w-full text-left rounded-2xl border border-gray-100 bg-white p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900 truncate">{row.full_name}</p>
                    <p className="text-xs text-gray-500 mt-0.5 truncate">{row.email} · {row.phone}</p>
                    <p className="text-xs text-gray-500 mt-1 capitalize">
                      {row.vehicle_type} · {row.vehicle_plate}
                    </p>
                    <p className="text-[11px] text-gray-400 mt-1">
                      {row.approved_vendor_locations
                        ? `${row.approved_vendor_locations.city}, ${row.approved_vendor_locations.state}`
                        : 'No area on file'}
                      {' · '}
                      {new Date(row.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 px-2 py-0.5 rounded-full text-[11px] font-medium capitalize ${
                      STATUS_BADGE[row.status] || 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {row.status.replace('_', ' ')}
                  </span>
                </div>

                {row.status === 'pending_review' && (
                  <div className="grid grid-cols-2 gap-2 mt-3">
                    <span
                      onClick={(e) => { e.stopPropagation(); runAction(row.id, 'approve'); }}
                      className="inline-flex items-center justify-center gap-1 rounded-xl bg-green-600 py-2.5 text-xs font-semibold text-white"
                    >
                      <CheckCircle className="w-4 h-4" />
                      Approve
                    </span>
                    <span
                      onClick={(e) => { e.stopPropagation(); setSelected(row); setRejecting(true); }}
                      className="inline-flex items-center justify-center gap-1 rounded-xl bg-red-50 py-2.5 text-xs font-semibold text-red-700"
                    >
                      <XCircle className="w-4 h-4" />
                      Reject
                    </span>
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      <Sheet open={Boolean(selected)} onClose={closeSheet} ariaLabel="Rider application details">
        {selected && (
          <>
            <div className="flex items-start justify-between gap-3 mb-1">
              <div className="min-w-0">
                <h3 className="font-semibold text-gray-900 text-base truncate">{selected.full_name}</h3>
                <p className="text-xs text-gray-500 truncate">{selected.email} · {selected.phone}</p>
              </div>
              <span
                className={`shrink-0 px-2 py-0.5 rounded-full text-[11px] font-medium capitalize ${
                  STATUS_BADGE[selected.status] || 'bg-gray-100 text-gray-600'
                }`}
              >
                {selected.status.replace('_', ' ')}
              </span>
            </div>

            <div className="space-y-2.5 text-sm mt-2">
              <DetailRow label="NIN" value={selected.nin} />
              <DetailRow label="Vehicle" value={`${selected.vehicle_type} · ${selected.vehicle_plate}`} />
              <DetailRow
                label="Area"
                value={
                  selected.approved_vendor_locations
                    ? `${selected.approved_vendor_locations.city}, ${selected.approved_vendor_locations.state}`
                    : '—'
                }
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
                  {selected.id_document_url && <DocLink href={selected.id_document_url} label="ID photo" />}
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
              <div className="flex gap-2 mt-4">
                <button
                  type="button"
                  disabled={actioning === selected.id}
                  onClick={() => runAction(selected.id, 'approve')}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-green-600 text-white text-sm font-semibold disabled:opacity-50"
                >
                  <CheckCircle className="w-4 h-4" />
                  Approve
                </button>
                <button
                  type="button"
                  disabled={actioning === selected.id}
                  onClick={() => setRejecting(true)}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-red-50 text-red-700 text-sm font-semibold disabled:opacity-50"
                >
                  <XCircle className="w-4 h-4" />
                  Reject
                </button>
              </div>
            )}

            {rejecting && (
              <div className="mt-4">
                <textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Reason for rejection (optional)"
                  className="w-full border rounded-xl p-3 text-sm min-h-[88px]"
                />
                <div className="flex gap-2 mt-3">
                  <button
                    type="button"
                    onClick={() => { setRejecting(false); setRejectReason(''); }}
                    className="flex-1 py-2.5 rounded-xl border text-sm font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={actioning === selected.id}
                    onClick={() => runAction(selected.id, 'reject', rejectReason)}
                    className="flex-1 py-2.5 rounded-xl bg-red-600 text-white text-sm font-semibold disabled:opacity-50"
                  >
                    Confirm reject
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </Sheet>
    </PullToRefresh>
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
      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-primary-700"
    >
      {label}
      <ExternalLink className="w-3 h-3" />
    </a>
  );
}
