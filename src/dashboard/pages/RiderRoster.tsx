import { Fragment, useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Bike, MapPin, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useNotification } from '../contexts/NotificationContext';

const functionsBase = import.meta.env.VITE_NETLIFY_FUNCTIONS_BASE || '/.netlify/functions';

type TownRider = {
  id: string;
  full_name: string;
  phone: string;
  vehicle_type: string;
  vehicle_plate: string;
  is_online: boolean;
};

type Town = {
  location_id: string;
  city: string;
  state: string;
  has_jlo_hub: boolean;
  has_courier_hub: boolean;
  rider_count: number;
  online_count: number;
  riders: TownRider[];
};

type RosterResponse = {
  towns: Town[];
  gaps: Town[];
  unassigned_riders: TownRider[];
  stats: {
    total_towns: number;
    covered_towns: number;
    gap_towns: number;
    total_active_riders: number;
    online_riders: number;
  };
};

export default function RiderRosterPage() {
  const { session } = useAuth();
  const notification = useNotification();
  const [data, setData] = useState<RosterResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session?.access_token) return;
    setLoading(true);
    try {
      const res = await fetch(`${functionsBase}/admin-riders`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || 'Failed to load roster');
      setData(payload.data);
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Failed to load roster');
    } finally {
      setLoading(false);
    }
  }, [notification, session?.access_token]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="w-full max-w-none px-4 sm:px-6 xl:px-8 py-4 md:py-6">
      <div className="flex items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <Bike className="w-8 h-8 text-primary-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Rider Roster</h1>
            <p className="text-sm text-gray-600">Active riders by town, and where coverage is missing.</p>
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

      {loading && !data ? (
        <div className="flex justify-center py-16 text-gray-400">
          <RefreshCw className="w-6 h-6 animate-spin" />
        </div>
      ) : data ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <StatCard label="Towns covered" value={`${data.stats.covered_towns}/${data.stats.total_towns}`} />
            <StatCard label="Coverage gaps" value={String(data.stats.gap_towns)} tone={data.stats.gap_towns > 0 ? 'warning' : 'default'} />
            <StatCard label="Active riders" value={String(data.stats.total_active_riders)} />
            <StatCard label="Online now" value={String(data.stats.online_riders)} />
          </div>

          {data.gaps.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-amber-900">
                    {data.gaps.length} {data.gaps.length === 1 ? 'town has' : 'towns have'} zero active riders
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {data.gaps.map((g) => (
                      <span key={g.location_id} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white border border-amber-200 text-xs font-medium text-amber-800">
                        <MapPin className="w-3 h-3" />
                        {g.city}, {g.state}
                        {!g.has_jlo_hub && !g.has_courier_hub && <span className="text-amber-500">· no hub</span>}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {data.unassigned_riders.length > 0 && (
            <div className="bg-white rounded-xl border shadow-sm p-4 mb-6">
              <p className="text-sm font-semibold text-gray-900">
                {data.unassigned_riders.length} active rider{data.unassigned_riders.length === 1 ? '' : 's'} with no assigned town
              </p>
              <p className="text-xs text-gray-500 mb-3">Counted in "Active riders" above, but not in any town row below — approve a service area for them in Rider Verifications.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {data.unassigned_riders.map((r) => (
                  <div key={r.id} className="flex items-center justify-between gap-2 text-xs border rounded-lg px-3 py-2">
                    <div>
                      <p className="font-medium text-gray-900">{r.full_name}</p>
                      <p className="text-gray-500">{r.phone}</p>
                    </div>
                    <span className={r.is_online ? 'text-green-600 font-medium' : 'text-gray-400'}>
                      {r.is_online ? 'Online' : 'Offline'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-left text-gray-600">
                  <tr>
                    <th className="px-4 py-3 font-medium">Town</th>
                    <th className="px-4 py-3 font-medium">Coverage type</th>
                    <th className="px-4 py-3 font-medium">Riders</th>
                    <th className="px-4 py-3 font-medium">Online</th>
                  </tr>
                </thead>
                <tbody>
                  {data.towns.map((town) => (
                    <Fragment key={town.location_id}>
                      <tr
                        onClick={() => setExpanded(expanded === town.location_id ? null : town.location_id)}
                        className={`border-t cursor-pointer hover:bg-gray-50 ${town.rider_count === 0 ? 'bg-amber-50/40' : ''}`}
                      >
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900">{town.city}</div>
                          <div className="text-xs text-gray-500">{town.state}</div>
                        </td>
                        <td className="px-4 py-3 text-gray-600 text-xs">
                          {town.has_jlo_hub ? 'JLO hub' : town.has_courier_hub ? 'Courier hub' : 'No hub — rider only'}
                        </td>
                        <td className="px-4 py-3">
                          {town.rider_count === 0 ? (
                            <span className="text-amber-700 font-semibold text-xs">No riders</span>
                          ) : (
                            <span className="text-gray-900">{town.rider_count}</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-1 text-xs text-gray-600">
                            {town.online_count > 0 ? <Wifi className="w-3.5 h-3.5 text-green-600" /> : <WifiOff className="w-3.5 h-3.5 text-gray-400" />}
                            {town.online_count}
                          </span>
                        </td>
                      </tr>
                      {expanded === town.location_id && town.riders.length > 0 && (
                        <tr className="border-t bg-gray-50">
                          <td colSpan={4} className="px-4 py-3">
                            <div className="space-y-1.5">
                              {town.riders.map((r) => (
                                <div key={r.id} className="flex items-center justify-between text-xs">
                                  <span className="text-gray-900 font-medium">{r.full_name}</span>
                                  <span className="text-gray-500">{r.phone}</span>
                                  <span className="text-gray-500 capitalize">{r.vehicle_type} · {r.vehicle_plate}</span>
                                  <span className={r.is_online ? 'text-green-600' : 'text-gray-400'}>
                                    {r.is_online ? 'Online' : 'Offline'}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
              {data.towns.length === 0 && (
                <p className="px-4 py-8 text-center text-gray-500 text-sm">No local-delivery towns configured yet.</p>
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

function StatCard({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'warning' }) {
  return (
    <div className={`rounded-xl border p-4 ${tone === 'warning' ? 'bg-amber-50 border-amber-200' : 'bg-white'}`}>
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-xl font-bold mt-1 ${tone === 'warning' ? 'text-amber-700' : 'text-gray-900'}`}>{value}</p>
    </div>
  );
}
