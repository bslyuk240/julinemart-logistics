import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Bike, ChevronDown, MapPin, Wifi, WifiOff } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { PullToRefresh } from '../PullToRefresh';

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

export default function MobileRiderRoster() {
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
    <PullToRefresh onRefresh={load}>
      <div className="px-4 pt-4 pb-24">
        <div className="flex items-center gap-2 mb-1">
          <Bike className="w-5 h-5 text-primary-600" />
          <h1 className="text-lg font-bold text-gray-900">Rider Roster</h1>
        </div>
        <p className="text-xs text-gray-500 mb-4">Active riders by town, and where coverage is missing</p>

        {loading && !data ? (
          <div className="py-12 text-center text-sm text-gray-500">Loading…</div>
        ) : data ? (
          <>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <StatCard label="Towns covered" value={`${data.stats.covered_towns}/${data.stats.total_towns}`} />
              <StatCard
                label="Coverage gaps"
                value={String(data.stats.gap_towns)}
                tone={data.stats.gap_towns > 0 ? 'warning' : 'default'}
              />
              <StatCard label="Active riders" value={String(data.stats.total_active_riders)} />
              <StatCard label="Online now" value={String(data.stats.online_riders)} />
            </div>

            {data.gaps.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3.5 mb-4">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-amber-900">
                      {data.gaps.length} {data.gaps.length === 1 ? 'town has' : 'towns have'} zero active riders
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {data.gaps.map((g) => (
                        <span
                          key={g.location_id}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-white border border-amber-200 text-[11px] font-medium text-amber-800"
                        >
                          <MapPin className="w-3 h-3" />
                          {g.city}, {g.state}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {data.unassigned_riders.length > 0 && (
              <div className="rounded-2xl border border-gray-200 bg-white p-4 mb-4">
                <p className="text-xs font-semibold text-gray-700 mb-0.5">
                  {data.unassigned_riders.length} active rider{data.unassigned_riders.length === 1 ? '' : 's'} with no assigned town
                </p>
                <p className="text-[11px] text-gray-400 mb-2">Counted in "Active riders" above, but not in any town below</p>
                <div className="space-y-2">
                  {data.unassigned_riders.map((r) => (
                    <div key={r.id} className="flex items-center justify-between gap-2 text-xs">
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900 truncate">{r.full_name}</p>
                        <p className="text-gray-500">{r.phone}</p>
                      </div>
                      <p className={r.is_online ? 'text-green-600 font-medium shrink-0' : 'text-gray-400 shrink-0'}>
                        {r.is_online ? 'Online' : 'Offline'}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {data.towns.length === 0 ? (
              <p className="py-8 text-center text-gray-500 text-sm">No local-delivery towns configured yet.</p>
            ) : (
              <div className="space-y-2.5">
                {data.towns.map((town) => {
                  const isOpen = expanded === town.location_id;
                  return (
                    <div
                      key={town.location_id}
                      className={`rounded-2xl border bg-white shadow-sm overflow-hidden ${
                        town.rider_count === 0 ? 'border-amber-200' : 'border-gray-100'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setExpanded(isOpen ? null : town.location_id)}
                        className="w-full flex items-center justify-between gap-3 p-4 text-left"
                      >
                        <div className="min-w-0">
                          <p className="font-semibold text-gray-900">{town.city}</p>
                          <p className="text-xs text-gray-500">{town.state}</p>
                          <p className="text-[11px] text-gray-400 mt-1">
                            {town.has_jlo_hub ? 'JLO hub' : town.has_courier_hub ? 'Courier hub' : 'No hub — rider only'}
                          </p>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <div className="text-right">
                            {town.rider_count === 0 ? (
                              <span className="text-amber-700 font-semibold text-xs">No riders</span>
                            ) : (
                              <span className="text-gray-900 text-sm font-medium">{town.rider_count} rider{town.rider_count === 1 ? '' : 's'}</span>
                            )}
                            <div className="flex items-center justify-end gap-1 text-xs text-gray-500 mt-0.5">
                              {town.online_count > 0 ? (
                                <Wifi className="w-3.5 h-3.5 text-green-600" />
                              ) : (
                                <WifiOff className="w-3.5 h-3.5 text-gray-400" />
                              )}
                              {town.online_count} online
                            </div>
                          </div>
                          <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                        </div>
                      </button>

                      {isOpen && town.riders.length > 0 && (
                        <div className="border-t border-gray-100 bg-gray-50 px-4 py-3 space-y-2.5">
                          {town.riders.map((r) => (
                            <div key={r.id} className="flex items-center justify-between gap-2 text-xs">
                              <div className="min-w-0">
                                <p className="font-medium text-gray-900 truncate">{r.full_name}</p>
                                <p className="text-gray-500">{r.phone}</p>
                              </div>
                              <div className="text-right shrink-0">
                                <p className="text-gray-500 capitalize">{r.vehicle_type} · {r.vehicle_plate}</p>
                                <p className={r.is_online ? 'text-green-600 font-medium' : 'text-gray-400'}>
                                  {r.is_online ? 'Online' : 'Offline'}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        ) : null}
      </div>
    </PullToRefresh>
  );
}

function StatCard({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'warning' }) {
  return (
    <div className={`rounded-2xl border p-3.5 ${tone === 'warning' ? 'bg-amber-50 border-amber-200' : 'border-gray-100 bg-white'}`}>
      <p className="text-[11px] text-gray-500">{label}</p>
      <p className={`text-lg font-bold mt-0.5 ${tone === 'warning' ? 'text-amber-700' : 'text-gray-900'}`}>{value}</p>
    </div>
  );
}
