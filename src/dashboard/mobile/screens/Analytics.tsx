import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Clock,
  Loader,
  MapPin,
  Package,
  RefreshCw,
  ShoppingBag,
  Store,
  TrendingUp,
  Truck,
  Users,
  XCircle,
} from 'lucide-react';
import { PullToRefresh } from '../PullToRefresh';
import { TABBAR_SPACE } from '../lib/functionsAuth';
import {
  STATUS_COLOR,
  STATUS_LABEL,
  type AnalyticsData,
  type MonthRow,
  fetchAnalytics,
  fmtAnalytics,
} from '../lib/insightsApi';

type BreakdownTab = 'vendors' | 'zones' | 'status';

function SuccessRing({ pct }: { pct: number }) {
  const clamped = Math.min(100, Math.max(0, pct));
  const deg = (clamped / 100) * 360;
  const color = clamped >= 80 ? '#34d399' : clamped >= 60 ? '#fbbf24' : '#f87171';
  return (
    <div
      className="relative h-16 w-16 shrink-0 rounded-full"
      style={{ background: `conic-gradient(${color} ${deg}deg, #334155 ${deg}deg)` }}
    >
      <div className="absolute inset-1.5 flex flex-col items-center justify-center rounded-full bg-slate-900">
        <span className="text-sm font-bold text-white">{clamped}%</span>
        <span className="text-[8px] uppercase tracking-wide text-slate-400">delivery</span>
      </div>
    </div>
  );
}

function RevenueMixBar({
  commission,
  shipping,
  margin,
  total,
}: {
  commission: number;
  shipping: number;
  margin: number;
  total: number;
}) {
  const segments = [
    { label: 'Commission', value: commission, cls: 'bg-blue-500' },
    { label: 'Shipping', value: shipping, cls: 'bg-teal-500' },
    { label: 'Own-store', value: margin, cls: 'bg-violet-500' },
  ];
  const sum = total || 1;
  return (
    <div className="space-y-2">
      <div className="flex h-3 overflow-hidden rounded-full bg-gray-100">
        {segments.map((s) =>
          s.value > 0 ? (
            <div key={s.label} className={s.cls} style={{ width: `${(s.value / sum) * 100}%` }} />
          ) : null,
        )}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {segments.map((s) => (
          <div key={s.label} className="flex items-center gap-1.5 text-[11px] text-gray-600">
            <span className={`h-2 w-2 rounded-full ${s.cls}`} />
            <span>{s.label}</span>
            <span className="font-semibold tabular-nums text-gray-900">{fmtAnalytics(s.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MonthlyTrendChart({ rows }: { rows: MonthRow[] }) {
  const chartRows = [...rows].slice(0, 6).reverse();
  const maxRev = Math.max(...chartRows.map((m) => Number(m.revenue || 0)), 1);

  if (chartRows.length === 0) {
    return <p className="py-6 text-center text-sm text-gray-400">No monthly data yet</p>;
  }

  return (
    <div className="flex items-end justify-between gap-1.5 pt-2" style={{ height: 120 }}>
      {chartRows.map((m) => {
        const rev = Number(m.revenue || 0);
        const profit = Number(m.gross_profit || 0);
        const revH = Math.max(8, (rev / maxRev) * 100);
        const profitH = rev > 0 ? Math.max(4, (Math.abs(profit) / maxRev) * 100) : 0;
        const label = m.period?.slice(5) || m.period;
        return (
          <div key={m.period} className="flex min-w-0 flex-1 flex-col items-center gap-1">
            <div className="relative flex w-full flex-1 items-end justify-center gap-0.5">
              <div className="w-[42%] rounded-t bg-indigo-200" style={{ height: `${revH}%` }} />
              <div
                className={`w-[42%] rounded-t ${profit >= 0 ? 'bg-emerald-500' : 'bg-red-400'}`}
                style={{ height: `${profitH}%` }}
              />
            </div>
            <span className="truncate text-[9px] font-medium text-gray-500">{label}</span>
          </div>
        );
      })}
    </div>
  );
}

function DeliveryStack({
  delivered,
  inProgress,
  failed,
  total,
}: {
  delivered: number;
  inProgress: number;
  failed: number;
  total: number;
}) {
  const t = Math.max(total, 1);
  return (
    <div className="space-y-3">
      <div className="flex h-3 overflow-hidden rounded-full bg-gray-100">
        {delivered > 0 && <div className="bg-emerald-500" style={{ width: `${(delivered / t) * 100}%` }} />}
        {inProgress > 0 && <div className="bg-blue-400" style={{ width: `${(inProgress / t) * 100}%` }} />}
        {failed > 0 && <div className="bg-red-400" style={{ width: `${(failed / t) * 100}%` }} />}
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-emerald-50 p-2 ring-1 ring-emerald-100">
          <CheckCircle className="mx-auto mb-0.5 h-3.5 w-3.5 text-emerald-600" />
          <p className="text-base font-bold tabular-nums text-emerald-700">{delivered}</p>
          <p className="text-[9px] text-emerald-600">Delivered</p>
        </div>
        <div className="rounded-xl bg-blue-50 p-2 ring-1 ring-blue-100">
          <Clock className="mx-auto mb-0.5 h-3.5 w-3.5 text-blue-600" />
          <p className="text-base font-bold tabular-nums text-blue-700">{inProgress}</p>
          <p className="text-[9px] text-blue-600">In transit</p>
        </div>
        <div className="rounded-xl bg-red-50 p-2 ring-1 ring-red-100">
          <XCircle className="mx-auto mb-0.5 h-3.5 w-3.5 text-red-500" />
          <p className="text-base font-bold tabular-nums text-red-600">{failed}</p>
          <p className="text-[9px] text-red-500">Failed</p>
        </div>
      </div>
    </div>
  );
}

export default function MobileAnalytics() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [breakdownTab, setBreakdownTab] = useState<BreakdownTab>('vendors');
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchAnalytics());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load analytics');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const marginRevenue = useMemo(() => {
    if (!data) return 0;
    const ov = data.overview;
    return ov.julinemart_revenue - ov.commission_revenue - ov.shipping_revenue;
  }, [data]);

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

  const ov = data.overview;
  const dl = data.delivery;
  const ops = data.operations;
  const maxVendorSales = Math.max(...data.top_vendors.map((v) => v.gross_sales), 1);
  const maxZoneOrders = Math.max(...data.orders_by_zone.map((z) => z.orders), 1);

  return (
    <PullToRefresh onRefresh={load}>
      <div className="space-y-4 p-4" style={{ paddingBottom: TABBAR_SPACE }}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-gray-900">Analytics</h1>
            <p className="text-xs text-gray-500">Business performance</p>
          </div>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="flex shrink-0 items-center gap-1 rounded-xl bg-white px-3 py-2 text-xs font-semibold text-gray-700 shadow-sm ring-1 ring-gray-100 disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {/* Hero */}
        <div className="overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-indigo-950 to-primary-900 p-4 text-white shadow-lg">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-wider text-indigo-300/80">JulineMart revenue</p>
              <p className="mt-1 text-2xl font-bold tabular-nums">{fmtAnalytics(ov.julinemart_revenue)}</p>
              <p className="mt-1 text-xs text-slate-400">
                {ov.total_orders.toLocaleString()} orders · {ov.paid_orders.toLocaleString()} paid
              </p>
            </div>
            <SuccessRing pct={dl.success_pct} />
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 border-t border-white/10 pt-3">
            <div>
              <p className="text-[10px] text-slate-400">Gross sales</p>
              <p className="text-sm font-semibold tabular-nums">{fmtAnalytics(ov.gross_sales)}</p>
            </div>
            <div>
              <p className="text-[10px] text-slate-400">Commission</p>
              <p className="text-sm font-semibold tabular-nums text-blue-300">{fmtAnalytics(ov.commission_revenue)}</p>
            </div>
            <div>
              <p className="text-[10px] text-slate-400">Vendors</p>
              <p className="text-sm font-semibold tabular-nums">{ov.active_vendors}</p>
            </div>
          </div>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50 to-blue-100 p-3">
            <ShoppingBag className="mb-1.5 h-4 w-4 text-blue-700" />
            <p className="text-[10px] text-gray-500">Paid conversion</p>
            <p className="text-sm font-bold tabular-nums text-blue-700">
              {ov.total_orders > 0 ? Math.round((ov.paid_orders / ov.total_orders) * 100) : 0}%
            </p>
            <p className="text-[10px] text-blue-600/70">{ov.paid_orders} of {ov.total_orders}</p>
          </div>
          <div className="rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50 to-violet-100 p-3">
            <TrendingUp className="mb-1.5 h-4 w-4 text-violet-700" />
            <p className="text-[10px] text-gray-500">Avg delivery</p>
            <p className="text-sm font-bold tabular-nums text-violet-700">{dl.avg_delivery_days || '—'} days</p>
            <p className="text-[10px] text-violet-600/70">{dl.delivered} delivered</p>
          </div>
        </div>

        {/* Revenue mix */}
        <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary-600" />
            <h2 className="text-sm font-semibold text-gray-900">Revenue mix</h2>
          </div>
          <RevenueMixBar
            commission={ov.commission_revenue}
            shipping={ov.shipping_revenue}
            margin={marginRevenue}
            total={ov.julinemart_revenue}
          />
        </div>

        {/* Monthly trend */}
        <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">Monthly trend</h2>
            <div className="flex gap-2 text-[10px] text-gray-500">
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded bg-indigo-200" />Rev</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded bg-emerald-500" />Profit</span>
            </div>
          </div>
          <MonthlyTrendChart rows={data.monthly_trend} />
        </div>

        {/* Monthly detail accordion */}
        {data.monthly_trend.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
            <div className="border-b border-gray-50 px-4 py-3">
              <h2 className="text-sm font-semibold text-gray-900">Month breakdown</h2>
              <p className="text-[10px] text-gray-400">Tap for revenue &amp; expenses</p>
            </div>
            <div className="divide-y divide-gray-50">
              {data.monthly_trend.map((m) => {
                const profit = Number(m.gross_profit || 0);
                const open = expandedMonth === m.period;
                return (
                  <div key={m.period}>
                    <button
                      type="button"
                      onClick={() => setExpandedMonth(open ? null : m.period)}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-gray-50"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900">{m.period}</p>
                        <p className="text-[11px] text-gray-500">
                          {Number(m.order_count || 0)} orders · Rev {fmtAnalytics(Number(m.revenue))}
                        </p>
                      </div>
                      <p className={`text-sm font-bold tabular-nums ${profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {fmtAnalytics(profit)}
                      </p>
                      {open ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
                    </button>
                    {open && (
                      <div className="grid grid-cols-2 gap-2 bg-indigo-50/40 px-4 pb-3 text-[11px] text-gray-600">
                        <div><span className="text-gray-400">Gross sales</span><br />{fmtAnalytics(Number(m.gross_sales))}</div>
                        <div><span className="text-gray-400">Expenses</span><br />{fmtAnalytics(Number(m.expenses))}</div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Delivery */}
        <div className="rounded-xl border border-emerald-100 bg-gradient-to-br from-emerald-50/80 to-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Truck className="h-4 w-4 text-emerald-600" />
              <h2 className="text-sm font-semibold text-gray-900">Delivery performance</h2>
            </div>
            <span className="text-xs font-semibold text-emerald-700">{dl.total} shipments</span>
          </div>
          <DeliveryStack delivered={dl.delivered} inProgress={dl.in_progress} failed={dl.failed} total={dl.total} />
          {ops.pending_settlement > 0 && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800 ring-1 ring-amber-100">
              {fmtAnalytics(ops.pending_settlement)} owed to couriers
            </p>
          )}
        </div>

        {/* Breakdown tabs */}
        <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
          <div className="flex border-b border-gray-100">
            {([
              { id: 'vendors' as const, label: 'Vendors', icon: Store },
              { id: 'zones' as const, label: 'Zones', icon: MapPin },
              { id: 'status' as const, label: 'Orders', icon: Package },
            ]).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setBreakdownTab(id)}
                className={`flex flex-1 items-center justify-center gap-1.5 py-3 text-xs font-semibold transition-colors ${
                  breakdownTab === id ? 'border-b-2 border-primary-600 text-primary-700' : 'text-gray-500'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>

          <div className="p-4">
            {breakdownTab === 'vendors' && (
              data.top_vendors.length === 0 ? (
                <p className="py-6 text-center text-sm text-gray-400">No vendor sales yet</p>
              ) : (
                <div className="space-y-3">
                  {data.top_vendors.map((v, i) => {
                    const pct = maxVendorSales > 0 ? (v.gross_sales / maxVendorSales) * 100 : 0;
                    return (
                      <div key={v.store_name}>
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <span className="flex min-w-0 items-center gap-2 text-xs font-medium text-gray-800">
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-100 text-[10px] font-bold text-violet-700">{i + 1}</span>
                            <span className="truncate">{v.store_name}</span>
                          </span>
                          <span className="shrink-0 text-xs font-bold tabular-nums text-gray-900">{fmtAnalytics(v.gross_sales)}</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                          <div className="h-full rounded-full bg-violet-400" style={{ width: `${pct}%` }} />
                        </div>
                        <p className="mt-0.5 text-[10px] text-gray-400">{v.orders} orders · {fmtAnalytics(v.commission)} commission</p>
                      </div>
                    );
                  })}
                </div>
              )
            )}

            {breakdownTab === 'zones' && (
              data.orders_by_zone.length === 0 ? (
                <p className="py-6 text-center text-sm text-gray-400">No zone data yet</p>
              ) : (
                <div className="space-y-3">
                  {data.orders_by_zone.map((z) => {
                    const pct = maxZoneOrders > 0 ? (z.orders / maxZoneOrders) * 100 : 0;
                    return (
                      <div key={z.zone}>
                        <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                          <span className="truncate font-medium text-gray-800">{z.zone}</span>
                          <span className="shrink-0 font-semibold tabular-nums text-gray-700">{z.orders} orders</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                          <div className="h-full rounded-full bg-blue-400" style={{ width: `${pct}%` }} />
                        </div>
                        <p className="mt-0.5 text-[10px] text-gray-400">{fmtAnalytics(z.revenue)} revenue</p>
                      </div>
                    );
                  })}
                </div>
              )
            )}

            {breakdownTab === 'status' && (
              Object.keys(data.order_statuses).length === 0 ? (
                <p className="py-6 text-center text-sm text-gray-400">No orders yet</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {Object.entries(data.order_statuses).map(([status, count]) => (
                    <span
                      key={status}
                      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${STATUS_COLOR[status] || 'bg-gray-100 text-gray-600'}`}
                    >
                      {STATUS_LABEL[status] || status}
                      <span className="text-sm font-bold">{count}</span>
                    </span>
                  ))}
                </div>
              )
            )}
          </div>
        </div>

        {/* Operations grid */}
        <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-gray-900">Network snapshot</h2>
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: 'Delivery zones', value: ops.zones, icon: MapPin, tone: 'text-blue-600 bg-blue-50' },
              { label: 'Active hubs', value: ops.active_hubs, icon: Package, tone: 'text-green-600 bg-green-50' },
              { label: 'Couriers', value: ops.courier_partners, icon: Truck, tone: 'text-orange-600 bg-orange-50' },
              { label: 'Vendors', value: ov.active_vendors, icon: Users, tone: 'text-violet-600 bg-violet-50' },
            ].map((s) => (
              <div key={s.label} className={`flex items-center gap-3 rounded-xl p-3 ${s.tone.split(' ')[1]}`}>
                <s.icon className={`h-4 w-4 shrink-0 ${s.tone.split(' ')[0]}`} />
                <div>
                  <p className="text-lg font-bold tabular-nums text-gray-900">{s.value}</p>
                  <p className="text-[10px] text-gray-500">{s.label}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </PullToRefresh>
  );
}
