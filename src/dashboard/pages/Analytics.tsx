import { useEffect, useState } from 'react';
import {
  TrendingUp, Package, Truck, Users, Store,
  CheckCircle, XCircle, Clock, RefreshCw,
  BarChart2, MapPin, DollarSign, ShoppingBag,
  AlertTriangle,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Overview {
  total_orders: number;
  paid_orders: number;
  julinemart_revenue: number;
  gross_sales: number;
  commission_revenue: number;
  shipping_revenue: number;
  active_vendors: number;
}

interface Delivery {
  total: number;
  delivered: number;
  failed: number;
  in_progress: number;
  success_pct: number;
  failed_pct: number;
  avg_delivery_days: number;
}

interface Operations {
  zones: number;
  active_hubs: number;
  courier_partners: number;
  pending_settlement: number;
}

interface ZoneStat  { zone: string; orders: number; revenue: number; }
interface VendorStat { store_name: string; orders: number; gross_sales: number; commission: number; }
interface MonthRow  { period: string; revenue: number; gross_sales: number; expenses: number; gross_profit: number; order_count: number; }

interface AnalyticsData {
  overview:       Overview;
  delivery:       Delivery;
  operations:     Operations;
  orders_by_zone: ZoneStat[];
  top_vendors:    VendorStat[];
  order_statuses: Record<string, number>;
  monthly_trend:  MonthRow[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt    = (n: number) => `₦${Number(n || 0).toLocaleString()}`;
const pct    = (n: number) => `${Number(n || 0).toFixed(1)}%`;
const apiBase = (import.meta as any).env?.VITE_API_BASE_URL || '';

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending', processing: 'Processing', partially_shipped: 'Part. Shipped',
  shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled', refunded: 'Refunded',
};
const STATUS_COLOR: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700', processing: 'bg-blue-100 text-blue-700',
  partially_shipped: 'bg-indigo-100 text-indigo-700', shipped: 'bg-purple-100 text-purple-700',
  delivered: 'bg-green-100 text-green-700', cancelled: 'bg-red-100 text-red-700',
  refunded: 'bg-gray-100 text-gray-600',
};

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse bg-gray-100 rounded-lg ${className}`} />;
}

// ─── Mini bar chart (CSS only) ────────────────────────────────────────────────

function MiniBar({ value, max, color = 'bg-primary-500' }: { value: number; max: number; color?: string }) {
  const w = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${w}%` }} />
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AnalyticsPage() {
  const [data, setData]       = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch(`${apiBase}/api/analytics`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Failed to load');
      setData(json.data);
    } catch (e: any) {
      setError(e.message || 'Could not load analytics');
    } finally {
      setLoading(false);
    }
  };

  // ── Loading state ──────────────────────────────────────────────────────────
  if (loading) return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-8 w-24" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28" />)}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Skeleton className="h-56 lg:col-span-2" />
        <Skeleton className="h-56" />
      </div>
    </div>
  );

  // ── Error state ────────────────────────────────────────────────────────────
  if (error) return (
    <div className="flex flex-col items-center justify-center h-80 gap-3 text-gray-500">
      <AlertTriangle className="w-10 h-10 text-red-400" />
      <p className="text-sm">{error}</p>
      <button onClick={load} className="btn-primary text-sm flex items-center gap-1.5">
        <RefreshCw className="w-4 h-4" /> Retry
      </button>
    </div>
  );

  const d = data!;
  const ov = d.overview;
  const dl = d.delivery;
  const ops = d.operations;
  const maxZoneOrders  = Math.max(...d.orders_by_zone.map(z => z.orders), 1);
  const maxVendorSales = Math.max(...d.top_vendors.map(v => v.gross_sales), 1);
  const maxMonthRev    = Math.max(...d.monthly_trend.map(m => Number(m.revenue)), 1);

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <BarChart2 className="w-6 h-6 text-primary-600" />
            Analytics
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Real-time performance metrics</p>
        </div>
        <button onClick={load} className="btn-secondary text-sm flex items-center gap-1.5">
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {/* ── Row 1: Overview cards ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: 'Total Orders',
            value: ov.total_orders,
            sub:   `${ov.paid_orders} paid`,
            icon:  ShoppingBag,
            bg:    'bg-blue-50 text-blue-600',
          },
          {
            label: 'JulineMart Revenue',
            value: fmt(ov.julinemart_revenue),
            sub:   `Gross sales ${fmt(ov.gross_sales)}`,
            icon:  DollarSign,
            bg:    'bg-green-50 text-green-600',
          },
          {
            label: 'Delivery Success',
            value: `${dl.success_pct}%`,
            sub:   `${dl.delivered} delivered · ${dl.failed} failed`,
            icon:  CheckCircle,
            bg:    dl.success_pct >= 80 ? 'bg-emerald-50 text-emerald-600' : 'bg-orange-50 text-orange-600',
          },
          {
            label: 'Active Vendors',
            value: ov.active_vendors,
            sub:   `${d.top_vendors.length} with sales`,
            icon:  Store,
            bg:    'bg-purple-50 text-purple-600',
          },
        ].map(c => (
          <div key={c.label} className="bg-white rounded-xl border border-gray-100 p-4">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center mb-3 ${c.bg}`}>
              <c.icon className="w-4 h-4" />
            </div>
            <p className="text-xs text-gray-500 mb-0.5">{c.label}</p>
            <p className="text-xl font-bold text-gray-900">{c.value}</p>
            <p className="text-xs text-gray-400 mt-0.5 truncate">{c.sub}</p>
          </div>
        ))}
      </div>

      {/* ── Row 2: Monthly trend + Delivery breakdown ─────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Monthly Revenue Trend */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 p-5">
          <h2 className="font-semibold text-gray-900 mb-1">Monthly Revenue Trend</h2>
          <p className="text-xs text-gray-400 mb-4">JulineMart earnings last 6 months</p>

          {d.monthly_trend.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-gray-400 text-sm">No data yet</div>
          ) : (
            <div className="space-y-3">
              {d.monthly_trend.map(m => {
                const rev  = Number(m.revenue);
                const exp  = Number(m.expenses);
                const prof = Number(m.gross_profit);
                return (
                  <div key={m.period}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="font-medium text-gray-700 w-16">{m.period}</span>
                      <div className="flex gap-4 text-gray-500">
                        <span>Rev <span className="font-semibold text-gray-800">{fmt(rev)}</span></span>
                        <span>Exp <span className="font-semibold text-red-500">{fmt(exp)}</span></span>
                        <span className={`font-semibold ${prof >= 0 ? 'text-green-600' : 'text-red-500'}`}>{fmt(prof)}</span>
                      </div>
                    </div>
                    <div className="flex gap-1 h-2">
                      <div
                        className="bg-primary-500 rounded-l-full"
                        style={{ width: `${Math.max(1, (rev / maxMonthRev) * 100)}%` }}
                      />
                      {exp > 0 && (
                        <div
                          className="bg-red-300 rounded-r-full"
                          style={{ width: `${Math.max(1, (exp / maxMonthRev) * 100)}%` }}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
              <div className="flex gap-4 pt-1">
                <span className="flex items-center gap-1 text-xs text-gray-400"><span className="w-2.5 h-2.5 rounded-sm bg-primary-500 inline-block" />Revenue</span>
                <span className="flex items-center gap-1 text-xs text-gray-400"><span className="w-2.5 h-2.5 rounded-sm bg-red-300 inline-block" />Expenses</span>
              </div>
            </div>
          )}
        </div>

        {/* Delivery Performance */}
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <h2 className="font-semibold text-gray-900 mb-1">Delivery Performance</h2>
          <p className="text-xs text-gray-400 mb-4">{dl.total} total shipments</p>

          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="flex items-center gap-1 text-gray-600"><CheckCircle className="w-3.5 h-3.5 text-green-500" />Delivered</span>
                <span className="font-semibold text-green-600">{dl.delivered} · {dl.success_pct}%</span>
              </div>
              <MiniBar value={dl.success_pct} max={100} color="bg-green-500" />
            </div>
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="flex items-center gap-1 text-gray-600"><Clock className="w-3.5 h-3.5 text-blue-500" />In Progress</span>
                <span className="font-semibold text-blue-600">{dl.in_progress}</span>
              </div>
              <MiniBar value={dl.in_progress} max={Math.max(dl.total, 1)} color="bg-blue-400" />
            </div>
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="flex items-center gap-1 text-gray-600"><XCircle className="w-3.5 h-3.5 text-red-400" />Failed</span>
                <span className="font-semibold text-red-500">{dl.failed} · {dl.failed_pct}%</span>
              </div>
              <MiniBar value={dl.failed_pct} max={100} color="bg-red-400" />
            </div>

            <div className="border-t border-gray-50 pt-3 mt-3 grid grid-cols-2 gap-2">
              <div className="bg-gray-50 rounded-lg p-2.5 text-center">
                <p className="text-lg font-bold text-gray-900">{dl.avg_delivery_days || '—'}</p>
                <p className="text-[10px] text-gray-500">Avg days</p>
              </div>
              <div className="bg-amber-50 rounded-lg p-2.5 text-center">
                <p className="text-lg font-bold text-amber-700">{fmt(ops.pending_settlement)}</p>
                <p className="text-[10px] text-amber-600">Owed couriers</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Row 3: Top Vendors + Orders by Zone ──────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Top Vendors */}
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <h2 className="font-semibold text-gray-900 mb-1 flex items-center gap-1.5">
            <Store className="w-4 h-4 text-purple-500" />Top Vendors by Sales
          </h2>
          <p className="text-xs text-gray-400 mb-4">From paid orders</p>

          {d.top_vendors.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">No vendor sales yet</p>
          ) : (
            <div className="space-y-3">
              {d.top_vendors.map((v, i) => (
                <div key={v.store_name}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="flex items-center gap-1.5 font-medium text-gray-800 truncate max-w-[55%]">
                      <span className="w-4 h-4 rounded-full bg-primary-100 text-primary-700 text-[10px] font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                      {v.store_name}
                    </span>
                    <div className="flex gap-3 text-right shrink-0">
                      <span className="text-gray-500">{fmt(v.gross_sales)}</span>
                      <span className="text-primary-600 font-semibold">{fmt(v.commission)} commission</span>
                    </div>
                  </div>
                  <MiniBar value={v.gross_sales} max={maxVendorSales} color="bg-purple-400" />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Orders by Zone */}
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <h2 className="font-semibold text-gray-900 mb-1 flex items-center gap-1.5">
            <MapPin className="w-4 h-4 text-blue-500" />Orders by Delivery Zone
          </h2>
          <p className="text-xs text-gray-400 mb-4">All-time order distribution</p>

          {d.orders_by_zone.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">No order data yet</p>
          ) : (
            <div className="space-y-3">
              {d.orders_by_zone.map(z => (
                <div key={z.zone}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="font-medium text-gray-800 truncate max-w-[55%]">{z.zone}</span>
                    <div className="flex gap-3 shrink-0">
                      <span className="text-gray-500">{z.orders} order{z.orders !== 1 ? 's' : ''}</span>
                      <span className="font-semibold text-gray-700">{fmt(z.revenue)}</span>
                    </div>
                  </div>
                  <MiniBar value={z.orders} max={maxZoneOrders} color="bg-blue-400" />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Row 4: Order status chips + Operations quick stats ────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Order Status Breakdown */}
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-1.5">
            <Package className="w-4 h-4 text-orange-500" />Order Statuses
          </h2>
          {Object.keys(d.order_statuses).length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">No orders yet</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {Object.entries(d.order_statuses).map(([status, count]) => (
                <span key={status} className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_COLOR[status] || 'bg-gray-100 text-gray-600'}`}>
                  {STATUS_LABEL[status] || status}
                  <span className="font-bold">{count}</span>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Revenue Breakdown */}
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-1.5">
            <TrendingUp className="w-4 h-4 text-green-500" />Revenue Breakdown
          </h2>
          <div className="space-y-3">
            {[
              { label: 'Vendor Commission', value: ov.commission_revenue, color: 'bg-primary-500' },
              { label: 'Shipping Collected', value: ov.shipping_revenue,  color: 'bg-blue-400' },
              { label: 'Own Products Margin', value: ov.julinemart_revenue - ov.commission_revenue - ov.shipping_revenue, color: 'bg-purple-400' },
            ].map(r => (
              <div key={r.label}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-gray-600">{r.label}</span>
                  <span className="font-semibold text-gray-800">{fmt(r.value)}</span>
                </div>
                <MiniBar value={r.value} max={Math.max(ov.julinemart_revenue, 1)} color={r.color} />
              </div>
            ))}
            <div className="border-t border-gray-50 pt-2 flex justify-between text-xs">
              <span className="font-semibold text-gray-700">Total Revenue</span>
              <span className="font-bold text-primary-600">{fmt(ov.julinemart_revenue)}</span>
            </div>
          </div>
        </div>

        {/* Operations */}
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-1.5">
            <Truck className="w-4 h-4 text-gray-500" />Operations
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Delivery Zones',   value: ops.zones,            icon: MapPin,  color: 'text-blue-600' },
              { label: 'Active Hubs',      value: ops.active_hubs,      icon: Package, color: 'text-green-600' },
              { label: 'Courier Partners', value: ops.courier_partners,  icon: Truck,   color: 'text-orange-600' },
              { label: 'Active Vendors',   value: ov.active_vendors,    icon: Users,   color: 'text-purple-600' },
            ].map(s => (
              <div key={s.label} className="bg-gray-50 rounded-lg p-3 text-center">
                <s.icon className={`w-4 h-4 mx-auto mb-1 ${s.color}`} />
                <p className="text-xl font-bold text-gray-900">{s.value}</p>
                <p className="text-[10px] text-gray-500 mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
