import { useCallback, useEffect, useState } from 'react';
import { GitBranch, RefreshCw, Users, X } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { useAuth } from '../contexts/AuthContext';
import { useNotification } from '../contexts/NotificationContext';

interface FunnelStage {
  stage: string;
  count: number;
  drop_off_pct: number | null;
}

interface JourneyData {
  funnel: FunnelStage[];
  range: { from: string; to: string };
}

interface DrilldownRow {
  // checkout_started rows
  id?: string;
  order_number?: number;
  customer_name?: string;
  customer_email?: string;
  customer_phone?: string;
  total_amount?: number;
  created_at?: string;
  // product_viewed rows
  product_name?: string | null;
  source_page?: string | null;
  viewed_at?: string;
}

const STAGE_TO_QUERY_KEY: Record<string, string> = {
  'Product Viewed': 'product_viewed',
  'Checkout Started': 'checkout_started',
};

const RANGE_OPTIONS = [
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
];

function StatCard({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="rounded-lg bg-purple-50 p-4 text-center">
      <p className="text-2xl font-bold text-purple-700">{value.toLocaleString()}</p>
      <p className="text-xs text-gray-500 mt-1">{label}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

export function CustomerJourneyPage() {
  const { session, user } = useAuth();
  const notification = useNotification();
  const apiBase = (import.meta as any).env?.VITE_API_BASE_URL || '';
  const canDrilldown = user?.role === 'admin' || user?.role === 'manager';

  const [rangeDays, setRangeDays] = useState(30);
  const [data, setData] = useState<JourneyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [drilldownStage, setDrilldownStage] = useState<string | null>(null);
  const [drilldownRows, setDrilldownRows] = useState<DrilldownRow[]>([]);
  const [drilldownLoading, setDrilldownLoading] = useState(false);

  const authHeaders = useCallback((): Record<string, string> => {
    return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
  }, [session]);

  const fetchFunnel = useCallback(async () => {
    setLoading(true);
    try {
      const to = new Date();
      const from = new Date(to.getTime() - rangeDays * 24 * 60 * 60 * 1000);
      const res = await fetch(
        `${apiBase}/api/customer-journey-analytics?from=${from.toISOString()}&to=${to.toISOString()}`,
        { headers: authHeaders() }
      );
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || `Request failed (${res.status})`);
      setData(json.data);
    } catch (err) {
      console.error('Customer journey fetch error:', err);
      notification.error('Failed to load', 'Unable to fetch customer journey data');
    } finally {
      setLoading(false);
    }
  }, [apiBase, authHeaders, rangeDays, notification]);

  useEffect(() => {
    fetchFunnel();
  }, [fetchFunnel]);

  const openDrilldown = async (stage: string) => {
    const queryKey = STAGE_TO_QUERY_KEY[stage];
    if (!queryKey) return;
    setDrilldownStage(stage);
    setDrilldownLoading(true);
    try {
      const to = new Date();
      const from = new Date(to.getTime() - rangeDays * 24 * 60 * 60 * 1000);
      const res = await fetch(
        `${apiBase}/api/customer-journey-drilldown?stage=${queryKey}&from=${from.toISOString()}&to=${to.toISOString()}`,
        { headers: authHeaders() }
      );
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || `Request failed (${res.status})`);
      setDrilldownRows(json.data || []);
    } catch (err) {
      console.error('Customer journey drilldown error:', err);
      notification.error('Failed to load', 'Unable to fetch customer list');
      setDrilldownStage(null);
    } finally {
      setDrilldownLoading(false);
    }
  };

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
            <GitBranch className="w-7 h-7 text-purple-600" />
            Customer Journey
          </h1>
          <p className="text-gray-600 mt-1">Where customers drop off between viewing a product and paying</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={rangeDays}
            onChange={(e) => setRangeDays(Number(e.target.value))}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
          >
            {RANGE_OPTIONS.map((r) => (
              <option key={r.days} value={r.days}>{r.label}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={fetchFunnel}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
        </div>
      ) : !data ? (
        <div className="text-center py-12 text-gray-500">No data available</div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            {data.funnel.map((stage) => (
              <StatCard
                key={stage.stage}
                label={stage.stage}
                value={stage.count}
                sub={stage.drop_off_pct != null ? `${stage.drop_off_pct}% drop-off` : undefined}
              />
            ))}
          </div>

          <div className="card mb-6">
            <h2 className="text-lg font-semibold mb-4">Funnel</h2>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={data.funnel}>
                <XAxis dataKey="stage" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" fill="#7c3aed" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {canDrilldown && (
            <div className="card">
              <h2 className="text-lg font-semibold mb-1">See who stalled</h2>
              <p className="text-sm text-gray-500 mb-4">Admin/manager only — shows customer name/email/phone.</p>
              <div className="flex flex-wrap gap-2">
                {Object.keys(STAGE_TO_QUERY_KEY).map((stage) => (
                  <button
                    key={stage}
                    type="button"
                    onClick={() => openDrilldown(stage)}
                    className="inline-flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
                  >
                    <Users className="w-4 h-4" />
                    {stage}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {drilldownStage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900">{drilldownStage} — stalled customers</h3>
              <button type="button" onClick={() => setDrilldownStage(null)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="overflow-y-auto p-5">
              {drilldownLoading ? (
                <div className="text-center py-8">
                  <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" />
                </div>
              ) : drilldownRows.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-8">Nobody stalled here in this range.</p>
              ) : (
                <div className="divide-y divide-gray-100">
                  {drilldownRows.map((row, i) => (
                    <div key={row.id || `${row.customer_email}-${i}`} className="py-3 text-sm">
                      {row.order_number != null ? (
                        <>
                          <p className="font-medium text-gray-800">#{row.order_number} — {row.customer_name}</p>
                          <p className="text-gray-500">{row.customer_email} {row.customer_phone ? `· ${row.customer_phone}` : ''}</p>
                          <p className="text-xs text-gray-400 mt-0.5">
                            NGN {Number(row.total_amount || 0).toLocaleString()} · {row.created_at ? new Date(row.created_at).toLocaleString() : ''}
                          </p>
                        </>
                      ) : (
                        <>
                          <p className="font-medium text-gray-800">{row.customer_email}</p>
                          <p className="text-gray-500">{row.product_name || 'Unknown product'}</p>
                          <p className="text-xs text-gray-400 mt-0.5">
                            {row.source_page} · {row.viewed_at ? new Date(row.viewed_at).toLocaleString() : ''}
                          </p>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
