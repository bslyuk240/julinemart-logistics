import { useEffect, useState } from 'react';
import { TrendingUp, AlertCircle } from 'lucide-react';
import { api } from '../lib/api';

const fmt = (n: number) => `₦${Number(n || 0).toLocaleString()}`;

const PERIODS = [
  { value: 'this_month',    label: 'This Month' },
  { value: 'last_month',    label: 'Last Month' },
  { value: 'last_3_months', label: 'Last 3 Months' },
  { value: 'last_6_months', label: 'Last 6 Months' },
  { value: 'all_time',      label: 'All Time' },
];

function BarChart({ data }: { data: { month: string; net_earnings: number; gross_sales: number }[] }) {
  if (!data.length) return <p className="text-gray-400 text-sm text-center py-8">No data</p>;
  const max = Math.max(...data.map(d => d.gross_sales), 1);
  return (
    <div className="flex items-end gap-2 h-40">
      {data.map((d, i) => (
        <div key={i} className="flex-1 flex flex-col items-center gap-1 group relative">
          {/* Tooltip */}
          <div className="absolute -top-16 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-xs rounded px-2 py-1 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none">
            <div>Gross: {fmt(d.gross_sales)}</div>
            <div>Net: {fmt(d.net_earnings)}</div>
          </div>
          {/* Gross bar */}
          <div className="w-full flex flex-col justify-end gap-0.5" style={{ height: `${Math.max(4, (d.gross_sales / max) * 140)}px` }}>
            <div className="w-full bg-gray-200 rounded-t" style={{ height: `${Math.max(2, ((d.gross_sales - d.net_earnings) / max) * 140)}px` }} title="Commission" />
            <div className="w-full bg-primary-500 rounded-t" style={{ height: `${Math.max(2, (d.net_earnings / max) * 140)}px` }} title="Net" />
          </div>
          <span className="text-xs text-gray-400">{new Date(d.month).toLocaleDateString('en-GB', { month: 'short' })}</span>
        </div>
      ))}
    </div>
  );
}

export default function Earnings() {
  const [data, setData]     = useState<any>(null);
  const [period, setPeriod] = useState('last_6_months');
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState('');

  useEffect(() => {
    setLoading(true);
    api.getEarnings(period)
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [period]);

  const s  = data?.period_summary || {};
  const at = data?.all_time || {};

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-gray-900">Earnings</h1>
        <select className="input w-48" value={period} onChange={e => setPeriod(e.target.value)}>
          {PERIODS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
      </div>

      {error && <div className="card flex items-center gap-3 text-red-600"><AlertCircle className="w-5 h-5" />{error}</div>}

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* Period summary */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Gross Sales',         value: fmt(s.gross_sales) },
              { label: 'Platform Commission', value: `- ${fmt(s.platform_commission)}`, sub: `${data?.commission_rate}%` },
              { label: 'Net Earnings',        value: fmt(s.net_earnings) },
              { label: 'Orders',              value: s.total_orders || 0 },
            ].map(c => (
              <div key={c.label} className="card text-center">
                <p className="text-xs text-gray-500 mb-1">{c.label}</p>
                <p className="text-xl font-bold text-gray-900">{c.value}</p>
                {c.sub && <p className="text-xs text-gray-400">{c.sub} fee</p>}
              </div>
            ))}
          </div>

          {/* All-time balance */}
          <div className="card bg-gradient-to-br from-primary-600 to-primary-700 text-white">
            <p className="text-primary-100 text-sm mb-1">Available Balance (All Time)</p>
            <p className="text-4xl font-bold mb-3">{fmt(at.available_balance)}</p>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><p className="text-primary-200">Total Net Earned</p><p className="font-semibold">{fmt(at.total_net_earnings)}</p></div>
              <div><p className="text-primary-200">Total Withdrawn</p><p className="font-semibold">{fmt(at.total_withdrawn)}</p></div>
            </div>
          </div>

          {/* Chart */}
          <div className="card">
            <h2 className="font-semibold text-gray-900 mb-4">Monthly Breakdown</h2>
            <div className="mb-3 flex items-center gap-4 text-xs">
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-primary-500 inline-block" />Net Earnings</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-gray-200 inline-block" />Commission</span>
            </div>
            <BarChart data={data?.monthly_chart || []} />
          </div>

          {/* Top products */}
          {data?.top_products?.length > 0 && (
            <div className="card">
              <h2 className="font-semibold text-gray-900 mb-4">Top Products by Revenue</h2>
              <div className="space-y-3">
                {data.top_products.map((p: any, i: number) => (
                  <div key={p.sku || i} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                    <div className="flex items-center gap-3">
                      <span className="w-6 h-6 rounded-full bg-primary-100 text-primary-700 text-xs font-bold flex items-center justify-center">{i + 1}</span>
                      <div>
                        <p className="text-sm font-medium text-gray-900 line-clamp-1">{p.name}</p>
                        {p.sku && <p className="text-xs text-gray-400">{p.sku} · {p.qty} sold</p>}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-green-600">{fmt(p.net)}</p>
                      <p className="text-xs text-gray-400">gross: {fmt(p.gross)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
