import { useCallback, useEffect, useState } from 'react';
import { Banknote, Bike, CheckCircle, Pause, Play, Search, Trash2, Truck, Wifi, WifiOff, XCircle } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { PullToRefresh } from '../PullToRefresh';
import { Sheet } from '../Sheet';

const functionsBase = import.meta.env.VITE_NETLIFY_FUNCTIONS_BASE || '/.netlify/functions';

type Rider = {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  vehicle_type: string;
  vehicle_plate: string;
  status: 'pending_review' | 'active' | 'suspended' | 'rejected';
  is_online: boolean;
  created_at: string;
  area: { city: string; state: string } | null;
  current_job: { status: string; tracking_number: string | null } | null;
  pending_bank_change: {
    bank_name: string;
    bank_account_number: string;
    bank_account_name: string;
    requested_at: string;
  } | null;
  pending_vehicle_change: {
    vehicle_type: string;
    vehicle_plate: string;
    requested_at: string;
  } | null;
};

const STATUS_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'pending_review', label: 'Pending' },
  { key: 'suspended', label: 'Suspended' },
  { key: 'rejected', label: 'Rejected' },
];

const STATUS_BADGE: Record<string, string> = {
  active: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-700',
  pending_review: 'bg-amber-100 text-amber-800',
  suspended: 'bg-gray-100 text-gray-600',
};

export default function MobileRiders() {
  const { session } = useAuth();
  const notification = useNotification();
  const [rows, setRows] = useState<Rider[]>([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [actioning, setActioning] = useState<string | null>(null);
  const [selected, setSelected] = useState<Rider | null>(null);
  const [suspendReason, setSuspendReason] = useState('');
  const [suspending, setSuspending] = useState(false);

  const load = useCallback(async () => {
    if (!session?.access_token) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ status: statusFilter, ...(search ? { search } : {}) });
      const res = await fetch(`${functionsBase}/admin-rider-list?${params}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || 'Failed to load riders');
      setRows(payload.data || []);
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Failed to load riders');
    } finally {
      setLoading(false);
    }
  }, [notification, session?.access_token, statusFilter, search]);

  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  const runAction = async (
    riderId: string,
    action: 'suspend' | 'reactivate' | 'approve_bank_change' | 'reject_bank_change' | 'approve_vehicle_change' | 'reject_vehicle_change' | 'delete',
    reason?: string
  ) => {
    if (!session?.access_token) return;
    setActioning(riderId);
    try {
      const res = await fetch(`${functionsBase}/rider-approve`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ rider_id: riderId, action, reject_reason: reason }),
      });
      const payload = await res.json();
      if (!res.ok || !payload.success) throw new Error(payload?.error || 'Action failed');
      notification.success(payload.message || 'Done');
      setSelected(null);
      setSuspending(false);
      setSuspendReason('');
      await load();
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActioning(null);
    }
  };

  const closeSheet = () => {
    setSelected(null);
    setSuspending(false);
    setSuspendReason('');
  };

  return (
    <PullToRefresh onRefresh={load}>
      <div className="px-4 pt-4 pb-24">
        <div className="flex items-center gap-2 mb-1">
          <Bike className="w-5 h-5 text-primary-600" />
          <h1 className="text-lg font-bold text-gray-900">Riders</h1>
        </div>
        <p className="text-xs text-gray-500 mb-3">Every rider on the platform, and what they're doing right now</p>

        <div className="relative mb-3">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, email, phone…"
            className="w-full pl-9 pr-3 py-2 border rounded-xl text-sm"
          />
        </div>

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

        {loading && rows.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-500">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-500">No riders match this filter</div>
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
                    <p className="text-xs text-gray-500 mt-1 capitalize">{row.vehicle_type} · {row.vehicle_plate}</p>
                    <p className="text-[11px] text-gray-400 mt-1">
                      {row.area ? `${row.area.city}, ${row.area.state}` : 'No area on file'}
                      {row.current_job ? ` · ${row.current_job.status.replace('_', ' ')}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium capitalize ${STATUS_BADGE[row.status] || 'bg-gray-100 text-gray-600'}`}>
                      {row.status.replace('_', ' ')}
                    </span>
                    {row.pending_bank_change && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-amber-700">
                        <Banknote className="w-3 h-3" />
                        Bank change
                      </span>
                    )}
                    {row.pending_vehicle_change && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-amber-700">
                        <Truck className="w-3 h-3" />
                        Vehicle change
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1 text-[11px] text-gray-500">
                      {row.is_online ? <Wifi className="w-3 h-3 text-green-600" /> : <WifiOff className="w-3 h-3 text-gray-400" />}
                      {row.is_online ? 'Online' : 'Offline'}
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <Sheet open={Boolean(selected)} onClose={closeSheet} ariaLabel="Rider details">
        {selected && (
          <>
            <div className="flex items-start justify-between gap-3 mb-1">
              <div className="min-w-0">
                <h3 className="font-semibold text-gray-900 text-base truncate">{selected.full_name}</h3>
                <p className="text-xs text-gray-500 truncate">{selected.email} · {selected.phone}</p>
              </div>
              <span className={`shrink-0 px-2 py-0.5 rounded-full text-[11px] font-medium capitalize ${STATUS_BADGE[selected.status] || 'bg-gray-100 text-gray-600'}`}>
                {selected.status.replace('_', ' ')}
              </span>
            </div>

            <div className="space-y-2.5 text-sm mt-3">
              <DetailRow label="Vehicle" value={`${selected.vehicle_type} · ${selected.vehicle_plate}`} />
              <DetailRow label="Area" value={selected.area ? `${selected.area.city}, ${selected.area.state}` : '—'} />
              <DetailRow label="Online" value={selected.is_online ? 'Yes' : 'No'} />
              <DetailRow
                label="Current job"
                value={selected.current_job ? `${selected.current_job.status.replace('_', ' ')} · ${selected.current_job.tracking_number || '—'}` : 'None'}
              />
              <DetailRow label="Joined" value={new Date(selected.created_at).toLocaleDateString()} />
            </div>

            {selected.status === 'pending_review' && (
              <p className="mt-4 text-xs text-amber-700 bg-amber-50 rounded-xl p-3">
                Review this application in Rider Verifications to approve or reject it.
              </p>
            )}

            {selected.pending_bank_change && (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs font-semibold text-amber-900">Payout account change requested</p>
                <p className="mt-1 text-xs text-amber-800">
                  {selected.pending_bank_change.bank_name} · {selected.pending_bank_change.bank_account_number} · {selected.pending_bank_change.bank_account_name}
                </p>
                <div className="flex gap-2 mt-3">
                  <button
                    type="button"
                    disabled={actioning === selected.id}
                    onClick={() => runAction(selected.id, 'approve_bank_change')}
                    className="flex-1 inline-flex items-center justify-center gap-1 py-2 rounded-lg bg-green-600 text-white text-xs font-semibold disabled:opacity-50"
                  >
                    <CheckCircle className="w-3.5 h-3.5" />
                    Approve
                  </button>
                  <button
                    type="button"
                    disabled={actioning === selected.id}
                    onClick={() => runAction(selected.id, 'reject_bank_change')}
                    className="flex-1 inline-flex items-center justify-center gap-1 py-2 rounded-lg bg-red-50 text-red-700 text-xs font-semibold disabled:opacity-50"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    Reject
                  </button>
                </div>
              </div>
            )}

            {selected.pending_vehicle_change && (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs font-semibold text-amber-900">Vehicle change requested</p>
                <p className="mt-1 text-xs text-amber-800 capitalize">
                  {selected.pending_vehicle_change.vehicle_type} · {selected.pending_vehicle_change.vehicle_plate}
                </p>
                <div className="flex gap-2 mt-3">
                  <button
                    type="button"
                    disabled={actioning === selected.id}
                    onClick={() => runAction(selected.id, 'approve_vehicle_change')}
                    className="flex-1 inline-flex items-center justify-center gap-1 py-2 rounded-lg bg-green-600 text-white text-xs font-semibold disabled:opacity-50"
                  >
                    <CheckCircle className="w-3.5 h-3.5" />
                    Approve
                  </button>
                  <button
                    type="button"
                    disabled={actioning === selected.id}
                    onClick={() => runAction(selected.id, 'reject_vehicle_change')}
                    className="flex-1 inline-flex items-center justify-center gap-1 py-2 rounded-lg bg-red-50 text-red-700 text-xs font-semibold disabled:opacity-50"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    Reject
                  </button>
                </div>
              </div>
            )}

            {selected.status === 'active' && !suspending && (
              <button
                type="button"
                disabled={actioning === selected.id}
                onClick={() => setSuspending(true)}
                className="w-full mt-4 inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-red-50 text-red-700 text-sm font-semibold disabled:opacity-50"
              >
                <Pause className="w-4 h-4" />
                Suspend rider
              </button>
            )}

            {suspending && (
              <div className="mt-4">
                <textarea
                  value={suspendReason}
                  onChange={(e) => setSuspendReason(e.target.value)}
                  placeholder="Reason for suspension (optional)"
                  className="w-full border rounded-xl p-3 text-sm min-h-[80px]"
                />
                <div className="flex gap-2 mt-3">
                  <button type="button" onClick={() => { setSuspending(false); setSuspendReason(''); }} className="flex-1 py-2.5 rounded-xl border text-sm font-medium">
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={actioning === selected.id}
                    onClick={() => runAction(selected.id, 'suspend', suspendReason)}
                    className="flex-1 py-2.5 rounded-xl bg-red-600 text-white text-sm font-semibold disabled:opacity-50"
                  >
                    Confirm suspend
                  </button>
                </div>
              </div>
            )}

            {selected.status === 'suspended' && (
              <button
                type="button"
                disabled={actioning === selected.id}
                onClick={() => runAction(selected.id, 'reactivate')}
                className="w-full mt-4 inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-green-600 text-white text-sm font-semibold disabled:opacity-50"
              >
                <Play className="w-4 h-4" />
                Reactivate rider
              </button>
            )}

            <button
              type="button"
              disabled={actioning === selected.id || Boolean(selected.current_job)}
              onClick={() => {
                if (selected.current_job) return;
                const ok = window.confirm(
                  `Permanently delete ${selected.full_name} (${selected.email})?\n\nThis removes their rider profile and login so the email can be used again.`
                );
                if (!ok) return;
                void runAction(selected.id, 'delete');
              }}
              className="w-full mt-3 inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-red-200 bg-red-50 text-red-700 text-sm font-semibold disabled:opacity-40"
            >
              <Trash2 className="w-4 h-4" />
              {selected.current_job ? 'Finish current job to delete' : 'Delete rider'}
            </button>
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
