import { useEffect, useState } from 'react';
import { TrendingUp, AlertCircle, Lock } from 'lucide-react';
import { api } from '../lib/api';

const fmt = (n: number) => `₦${Number(n || 0).toLocaleString()}`;

const PERIODS = [
  { value: 'this_month',    label: 'This Month' },
  { value: 'last_month',    label: 'Last Month' },
  { value: 'last_3_months', label: '3 Months' },
  { value: 'last_6_months', label: '6 Months' },
  { value: 'all_time',      label: 'All Time' },
];

function BarChart({ data }: { data: { month: string; net_earnings: number; gross_sales: number }[] }) {
  if (!data.length) return <p className="text-gray-400 text-sm text-center py-8">No data for this period</p>;
  const max = Math.max(...data.map(d => d.gross_sales), 1);
  return (
    <div className="flex items-end gap-1.5 h-32">
      {data.map((d, i) => (
        <div key={i} className="flex-1 flex flex-col items-center gap-1 group relative">
          {/* Tooltip */}
          <div className="absolute -top-14 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-xs rounded-lg px-2 py-1.5 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none">
            <div>Gross: {fmt(d.gross_sales)}</div>
            <div>Net: {fmt(d.net_earnings)}</div>
          </div>
          <div className="w-full flex flex-col justify-end gap-0.5" style={{ height: `${Math.max(4, (d.gross_sales / max) * 120)}px` }}>
            <div className="w-full bg-gray-200 rounded-t" style={{ height: `${Math.max(2, ((d.gross_sales - d.net_earnings) / max) * 120)}px` }} />
            <div className="w-full bg-primary-500 rounded-t" style={{ height: `${Math.max(2, (d.net_earnings / max) * 120)}px` }} />
          </div>
          <span className="text-[10px] text-gray-400">
            {new Date(d.month).toLocaleDateString('en-GB', { month: 'short' })}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function Earnings() {
  const [data, setData]       = useState<any>(null);
  const [period, setPeriod]   = useState('last_6_months');
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

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
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-gray-900">Earnings</h1>
      </div>

      {/* Period selector — scrollable chips */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 lg:mx-0 lg:px-0">
        {PERIODS.map(p => (
          <button
            key={p.value}
            onClick={() => setPeriod(p.value)}
            className={`flex-shrink-0 px-4 py-2 rounded-full text-sm font-semibold border transition-colors ${
              period === p.value
                ? 'bg-primary-600 text-white border-primary-600'
                : 'bg-white text-gray-600 border-gray-300'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="card flex items-center gap-3 text-red-600">
          <AlertCircle className="w-5 h-5 flex-shrink-0" /> {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* All-time balance — hero card */}
          <div className="brand-gradient rounded-2xl p-5 text-white">
            <p className="text-primary-100 text-xs font-medium mb-1">Available Balance · All Time</p>
            <p className="text-3xl font-bold">{fmt(at.available_balance)}</p>
            <p className="text-primary-200 text-xs mt-2">Only confirmed (paid) orders count toward earnings.</p>
            <div className="grid grid-cols-2 gap-3 mt-4">
              <div className="bg-white/10 rounded-xl p-3">
                <p className="text-primary-200 text-xs">Total Net Earned</p>
                <p className="font-bold text-sm mt-0.5">{fmt(at.total_net_earnings)}</p>
              </div>
              <div className="bg-white/10 rounded-xl p-3">
                <p className="text-primary-200 text-xs">Total Withdrawn</p>
                <p className="font-bold text-sm mt-0.5">{fmt(at.total_withdrawn)}</p>
              </div>
            </div>
          </div>

          {/* Period stats — 2 col on mobile, 4 col on desktop */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: 'Gross Sales',  value: fmt(s.gross_sales),               sub: null },
              { label: 'Commission',   value: `- ${fmt(s.platform_commission)}`, sub: `${data?.commission_rate}% fee` },
              { label: 'Net Earnings', value: fmt(s.net_earnings),               sub: null, bold: true },
              { label: 'Orders',       value: s.total_orders || 0,               sub: 'This period' },
            ].map(c => (
              <div key={c.label} className="card text-center p-4">
                <p className="text-xs text-gray-500 mb-1">{c.label}</p>
                <p className={`text-lg font-bold ${c.bold ? 'text-green-600' : 'text-gray-900'}`}>{c.value}</p>
                {c.sub && <p className="text-xs text-gray-400">{c.sub}</p>}
              </div>
            ))}
          </div>

          {/* COGS & Profit — only shown when cost_price data exists */}
          {s.cogs_tracked && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4">
              <div className="flex items-center gap-1.5 mb-3">
                <Lock className="w-3.5 h-3.5 text-amber-600" />
                <p className="text-sm font-semibold text-amber-800">Your Profitability</p>
                <span className="ml-auto text-[10px] bg-amber-100 text-amber-700 rounded-full px-2 py-0.5 font-medium">Private · Admin cannot see this</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-white rounded-xl p-3 text-center border border-amber-100">
                  <p className="text-xs text-gray-500 mb-1">Cost of Goods (COGS)</p>
                  <p className="text-lg font-bold text-gray-800">- {fmt(s.total_cogs)}</p>
                  <p className="text-xs text-gray-400">Partial if not all products have cost set</p>
                </div>
                <div className="bg-white rounded-xl p-3 text-center border border-amber-100">
                  <p className="text-xs text-gray-500 mb-1">Gross Profit</p>
                  <p className={`text-lg font-bold ${(s.gross_profit ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {fmt(s.gross_profit ?? 0)}
                  </p>
                  <p className="text-xs text-gray-400">Net earnings minus COGS</p>
                </div>
              </div>
            </div>
          )}

          {/* Chart */}
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-gray-900 text-sm">Monthly Breakdown</h2>
              <div className="flex items-center gap-3 text-xs text-gray-500">
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-primary-500 inline-block" />Net</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-gray-200 inline-block" />Fee</span>
              </div>
            </div>
            <BarChart data={data?.monthly_chart || []} />
          </div>

          {/* Top products */}
          {data?.top_products?.length > 0 && (
            <div className="card">
              <h2 className="font-semibold text-gray-900 mb-4 text-sm">Top Products by Revenue</h2>
              {/* Mobile */}
              <div className="space-y-3 lg:hidden">
                {data.top_products.map((p: any, i: number) => (
                  <div key={p.sku || i} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
                    <span className="w-7 h-7 rounded-full bg-primary-100 text-primary-700 text-xs font-bold flex items-center justify-center flex-shrink-0">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{p.name}</p>
                      {p.sku && <p className="text-xs text-gray-400">{p.sku} · {p.qty} sold</p>}
                    </div>
                    <div className="text-right flex-shrink-0">
                      {p.profit != null
                        ? <p className="text-sm font-bold text-green-600">{fmt(p.profit)} profit</p>
                        : <p className="text-sm font-bold text-green-600">{fmt(p.net)} net</p>
                      }
                      <p className="text-xs text-gray-400">{fmt(p.gross)} gross</p>
                    </div>
                  </div>
                ))}
              </div>
              {/* Desktop table */}
              <table className="hidden lg:table w-full text-sm">
                <thead className="text-xs text-gray-500 uppercase tracking-wider border-b border-gray-100">
                  <tr>
                    <th className="pb-2 text-left">#</th>
                    <th className="pb-2 text-left">Product</th>
                    <th className="pb-2 text-left">SKU</th>
                    <th className="pb-2 text-right">Qty Sold</th>
                    <th className="pb-2 text-right">Gross</th>
                    <th className="pb-2 text-right">Net Earnings</th>
                    {data.top_products.some((p: any) => p.profit != null) && (
                      <th className="pb-2 text-right text-amber-700">Profit 🔒</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {data.top_products.map((p: any, i: number) => (
                    <tr key={p.sku || i} className="hover:bg-gray-50">
                      <td className="py-3 pr-3 text-gray-400 font-medium">{i + 1}</td>
                      <td className="py-3 pr-3 font-medium text-gray-900">{p.name}</td>
                      <td className="py-3 pr-3 text-gray-400 font-mono text-xs">{p.sku || '—'}</td>
                      <td className="py-3 text-right text-gray-700">{p.qty}</td>
                      <td className="py-3 text-right text-gray-700">{fmt(p.gross)}</td>
                      <td className="py-3 text-right font-bold text-green-600">{fmt(p.net)}</td>
                      {data.top_products.some((pp: any) => pp.profit != null) && (
                        <td className="py-3 text-right font-bold text-amber-700">
                          {p.profit != null ? fmt(p.profit) : <span className="text-gray-300 font-normal">—</span>}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Link to withdrawals */}
          <div className="text-center pb-2">
            <a href="/withdrawals" className="btn-primary inline-flex">
              <TrendingUp className="w-4 h-4" />
              Request Withdrawal
            </a>
          </div>
        </>
      )}
    </div>
  );
}
