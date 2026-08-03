import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, GitBranch, Loader, RefreshCw, Users } from 'lucide-react';
import { PullToRefresh } from '../PullToRefresh';
import { Sheet } from '../Sheet';
import { TABBAR_SPACE } from '../lib/functionsAuth';
import { useAuth } from '../../contexts/AuthContext';

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
  id?: string;
  order_number?: number;
  customer_name?: string;
  customer_email?: string;
  customer_phone?: string;
  total_amount?: number;
  created_at?: string;
  product_name?: string | null;
  source_page?: string | null;
  viewed_at?: string;
}

const STAGE_TO_QUERY_KEY: Record<string, string> = {
  'Product Viewed': 'product_viewed',
  'Checkout Started': 'checkout_started',
};

const RANGE_OPTIONS = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
];

const STAGE_COLOR = ['bg-violet-400', 'bg-blue-400', 'bg-emerald-500'];

function apiUrls(path: string): string[] {
  const full = path.startsWith('/api') ? path : `/api${path}`;
  const urls = [full];
  if (typeof window !== 'undefined' && window.location.hostname === 'localhost' && window.location.port !== '8888') {
    urls.push(`http://localhost:8888${full}`);
  }
  return urls;
}

export default function MobileCustomerJourney() {
  const { session, user } = useAuth();
  const canDrilldown = user?.role === 'admin' || user?.role === 'manager';

  const [rangeDays, setRangeDays] = useState(30);
  const [data, setData] = useState<JourneyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drilldownStage, setDrilldownStage] = useState<string | null>(null);
  const [drilldownRows, setDrilldownRows] = useState<DrilldownRow[]>([]);
  const [drilldownLoading, setDrilldownLoading] = useState(false);

  const authHeaders = useCallback((): Record<string, string> => {
    return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
  }, [session]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const to = new Date();
      const from = new Date(to.getTime() - rangeDays * 24 * 60 * 60 * 1000);
      let lastError: Error | null = null;
      for (const url of apiUrls(`/customer-journey-analytics?from=${from.toISOString()}&to=${to.toISOString()}`)) {
        try {
          const res = await fetch(url, { headers: authHeaders() });
          const json = await res.json();
          if (!res.ok || !json.success) throw new Error(json.error || `Request failed (${res.status})`);
          setData(json.data);
          lastError = null;
          break;
        } catch (err) {
          lastError = err instanceof Error ? err : new Error('Request failed');
        }
      }
      if (lastError) throw lastError;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load customer journey data');
    } finally {
      setLoading(false);
    }
  }, [rangeDays, authHeaders]);

  useEffect(() => {
    load();
  }, [load]);

  const openDrilldown = async (stage: string) => {
    const queryKey = STAGE_TO_QUERY_KEY[stage];
    if (!queryKey) return;
    setDrilldownStage(stage);
    setDrilldownLoading(true);
    try {
      const to = new Date();
      const from = new Date(to.getTime() - rangeDays * 24 * 60 * 60 * 1000);
      let lastError: Error | null = null;
      for (const url of apiUrls(`/customer-journey-drilldown?stage=${queryKey}&from=${from.toISOString()}&to=${to.toISOString()}`)) {
        try {
          const res = await fetch(url, { headers: authHeaders() });
          const json = await res.json();
          if (!res.ok || !json.success) throw new Error(json.error || `Request failed (${res.status})`);
          setDrilldownRows(json.data || []);
          lastError = null;
          break;
        } catch (err) {
          lastError = err instanceof Error ? err : new Error('Request failed');
        }
      }
      if (lastError) throw lastError;
    } catch {
      setDrilldownRows([]);
    } finally {
      setDrilldownLoading(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="flex justify-center py-20">
        <Loader className="h-8 w-8 animate-spin text-primary-600" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex flex-col items-center gap-3 px-4 py-20 text-gray-500">
        <AlertTriangle className="h-10 w-10 text-red-400" />
        <p className="text-sm">{error}</p>
        <button type="button" onClick={load} className="flex items-center gap-1.5 rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white">
          <RefreshCw className="h-4 w-4" />
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  const maxCount = Math.max(...data.funnel.map((s) => s.count), 1);

  return (
    <>
      <PullToRefresh onRefresh={load}>
        <div className="space-y-4 p-4" style={{ paddingBottom: TABBAR_SPACE }}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-lg font-bold text-gray-900 flex items-center gap-1.5">
                <GitBranch className="h-4 w-4 text-primary-600" />
                Customer Journey
              </h1>
              <p className="text-xs text-gray-500">Where customers drop off</p>
            </div>
            <button
              type="button"
              onClick={load}
              disabled={loading}
              className="flex shrink-0 items-center gap-1 rounded-xl bg-white px-3 py-2 text-xs font-semibold text-gray-700 shadow-sm ring-1 ring-gray-100 disabled:opacity-60"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {/* Range selector */}
          <div className="flex gap-1.5">
            {RANGE_OPTIONS.map((r) => (
              <button
                key={r.days}
                type="button"
                onClick={() => setRangeDays(r.days)}
                className={`rounded-full px-3 py-1.5 text-[11px] font-semibold ${
                  rangeDays === r.days ? 'bg-primary-600 text-white' : 'bg-white text-gray-600 ring-1 ring-gray-200'
                }`}
              >
                Last {r.label}
              </button>
            ))}
          </div>

          {/* Funnel */}
          <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-gray-900">Funnel</h2>
            <div className="space-y-4">
              {data.funnel.map((stage, i) => {
                const pct = (stage.count / maxCount) * 100;
                return (
                  <div key={stage.stage}>
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-gray-800">{stage.stage}</span>
                      <span className="text-xs font-bold tabular-nums text-gray-900">
                        {stage.count.toLocaleString()}
                        {stage.drop_off_pct != null && (
                          <span className="ml-1.5 font-normal text-red-500">-{stage.drop_off_pct}%</span>
                        )}
                      </span>
                    </div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-gray-100">
                      <div className={`h-full rounded-full ${STAGE_COLOR[i % STAGE_COLOR.length]}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Drilldown access */}
          {canDrilldown && (
            <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
              <h2 className="mb-0.5 text-sm font-semibold text-gray-900">See who stalled</h2>
              <p className="mb-3 text-[11px] text-gray-400">Admin/manager only — shows name/email/phone</p>
              <div className="flex flex-wrap gap-2">
                {Object.keys(STAGE_TO_QUERY_KEY).map((stage) => (
                  <button
                    key={stage}
                    type="button"
                    onClick={() => openDrilldown(stage)}
                    className="flex items-center gap-1.5 rounded-xl bg-primary-50 px-3 py-2 text-xs font-semibold text-primary-700"
                  >
                    <Users className="h-3.5 w-3.5" />
                    {stage}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </PullToRefresh>

      <Sheet open={!!drilldownStage} onClose={() => setDrilldownStage(null)} ariaLabel="Customer journey drilldown">
        <h2 className="text-base font-bold text-gray-900">{drilldownStage} — stalled customers</h2>
        {drilldownLoading ? (
          <div className="flex justify-center py-8">
            <Loader className="h-6 w-6 animate-spin text-primary-600" />
          </div>
        ) : drilldownRows.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">Nobody stalled here in this range.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {drilldownRows.map((row, i) => (
              <div key={row.id || `${row.customer_email}-${i}`} className="py-3 text-sm">
                {row.order_number != null ? (
                  <>
                    <p className="font-medium text-gray-900">#{row.order_number} — {row.customer_name}</p>
                    <p className="text-gray-500">{row.customer_email} {row.customer_phone ? `· ${row.customer_phone}` : ''}</p>
                    <p className="mt-0.5 text-xs text-gray-400">
                      NGN {Number(row.total_amount || 0).toLocaleString()} · {row.created_at ? new Date(row.created_at).toLocaleString() : ''}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="font-medium text-gray-900">{row.customer_email}</p>
                    <p className="text-gray-500">{row.product_name || 'Unknown product'}</p>
                    <p className="mt-0.5 text-xs text-gray-400">
                      {row.source_page} · {row.viewed_at ? new Date(row.viewed_at).toLocaleString() : ''}
                    </p>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </Sheet>
    </>
  );
}
