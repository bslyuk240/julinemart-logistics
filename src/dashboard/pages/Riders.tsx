import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bike, CheckCircle, Pause, Play, RefreshCw, Search, Wifi, WifiOff, XCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useNotification } from '../contexts/NotificationContext';

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
  last_online_at: string | null;
  created_at: string;
  approved_at: string | null;
  area: { city: string; state: string } | null;
  current_job: { status: string; tracking_number: string | null } | null;
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

export default function RidersPage() {
  const { session } = useAuth();
  const notification = useNotification();
  const [rows, setRows] = useState<Rider[]>([]);
  const [stats, setStats] = useState<Record<string, number> | null>(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [actioning, setActioning] = useState<string | null>(null);

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
      setStats(payload.stats || null);
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

  const runAction = async (rider: Rider, action: 'suspend' | 'reactivate') => {
    if (!session?.access_token) return;
    let reject_reason: string | undefined;
    if (action === 'suspend') {
      const reason = window.prompt(`Reason for suspending ${rider.full_name}? (optional)`);
      if (reason === null) return; // cancelled
      reject_reason = reason || undefined;
    }
    setActioning(rider.id);
    try {
      const res = await fetch(`${functionsBase}/rider-approve`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ rider_id: rider.id, action, reject_reason }),
      });
      const payload = await res.json();
      if (!res.ok || !payload.success) throw new Error(payload?.error || 'Action failed');
      notification.success(action === 'suspend' ? 'Rider suspended' : 'Rider reactivated');
      await load();
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActioning(null);
    }
  };

  const counts = useMemo(
    () => ({
      total: rows.length,
      online: stats?.online ?? 0,
    }),
    [rows, stats]
  );

  return (
    <div className="w-full max-w-none px-4 sm:px-6 xl:px-8 py-4 md:py-6">
      <div className="flex items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <Bike className="w-8 h-8 text-primary-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Riders</h1>
            <p className="text-sm text-gray-600">Every rider on the platform — contact info, status, and current job.</p>
          </div>
        </div>
        <button type="button" onClick={load} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm hover:bg-gray-50">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, email, phone…"
            className="w-full pl-9 pr-3 py-2 border rounded-lg text-sm"
          />
        </div>
        <div className="flex gap-2">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setStatusFilter(f.key)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold ${
                statusFilter === f.key ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {f.label}
              {stats && f.key !== 'all' && f.key in stats ? ` (${stats[f.key]})` : ''}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-gray-500">
          {counts.total} shown · {counts.online} online now
        </span>
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
                <th className="px-4 py-3 font-medium">Online</th>
                <th className="px-4 py-3 font-medium">Current job</th>
                <th className="px-4 py-3 font-medium">Joined</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-gray-400">
                    <RefreshCw className="w-5 h-5 animate-spin inline" />
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-gray-500">
                    No riders match this filter
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{r.full_name}</div>
                      <div className="text-xs text-gray-500">{r.email} · {r.phone}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600 capitalize">
                      {r.vehicle_type}{r.vehicle_plate ? ` · ${r.vehicle_plate}` : ''}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {r.area ? `${r.area.city}, ${r.area.state}` : <span className="text-amber-600">Unassigned</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium capitalize ${STATUS_BADGE[r.status] || 'bg-gray-100 text-gray-600'}`}>
                        {r.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1 text-xs text-gray-600">
                        {r.is_online ? <Wifi className="w-3.5 h-3.5 text-green-600" /> : <WifiOff className="w-3.5 h-3.5 text-gray-400" />}
                        {r.is_online ? 'Online' : 'Offline'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {r.current_job ? `${r.current_job.status.replace('_', ' ')} · ${r.current_job.tracking_number || '—'}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">{new Date(r.created_at).toLocaleDateString()}</td>
                    <td className="px-4 py-3">
                      {r.status === 'active' && (
                        <button
                          type="button"
                          disabled={actioning === r.id}
                          onClick={() => runAction(r, 'suspend')}
                          className="inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
                        >
                          <Pause className="w-3.5 h-3.5" />
                          Suspend
                        </button>
                      )}
                      {r.status === 'suspended' && (
                        <button
                          type="button"
                          disabled={actioning === r.id}
                          onClick={() => runAction(r, 'reactivate')}
                          className="inline-flex items-center gap-1 text-xs font-medium text-green-700 hover:text-green-800 disabled:opacity-50"
                        >
                          <Play className="w-3.5 h-3.5" />
                          Reactivate
                        </button>
                      )}
                      {r.status === 'pending_review' && (
                        <span className="inline-flex items-center gap-1 text-xs text-amber-700">
                          <CheckCircle className="w-3.5 h-3.5" />
                          Review in Verifications
                        </span>
                      )}
                      {r.status === 'rejected' && (
                        <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                          <XCircle className="w-3.5 h-3.5" />
                          Rejected
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
