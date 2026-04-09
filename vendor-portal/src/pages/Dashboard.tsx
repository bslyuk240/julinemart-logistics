import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { TrendingUp, ShoppingBag, Package, Wallet, ArrowRight, AlertCircle } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

const fmt = (n: number) => `₦${Number(n || 0).toLocaleString()}`;

const STATUS_COLORS: Record<string, string> = {
  delivered:        'bg-green-100 text-green-700',
  processing:       'bg-blue-100 text-blue-700',
  in_transit:       'bg-indigo-100 text-indigo-700',
  out_for_delivery: 'bg-purple-100 text-purple-700',
  pending:          'bg-yellow-100 text-yellow-700',
  cancelled:        'bg-red-100 text-red-600',
};

function StatCard({ label, value, sub, icon: Icon, color }: any) {
  return (
    <div className="card flex items-center gap-4">
      <div className={`p-3 rounded-2xl flex-shrink-0 ${color}`}>
        <Icon className="w-5 h-5 text-white" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-gray-500 truncate">{label}</p>
        <p className="text-xl font-bold text-gray-900 truncate">{value}</p>
        {sub && <p className="text-xs text-gray-400 truncate">{sub}</p>}
      </div>
    </div>
  );
}

function MiniChart({ data }: { data: { month: string; net_earnings: number }[] }) {
  if (!data.length) return null;
  const max = Math.max(...data.map(d => d.net_earnings), 1);
  return (
    <div className="flex items-end gap-1.5 h-14">
      {data.map((d, i) => (
        <div key={i} className="flex-1 flex flex-col items-center gap-1">
          <div
            className="w-full bg-primary-500 rounded-t opacity-80 hover:opacity-100 transition-opacity"
            style={{ height: `${Math.max(4, (d.net_earnings / max) * 48)}px` }}
            title={`${new Date(d.month).toLocaleDateString('en-GB', { month: 'short' })}: ${fmt(d.net_earnings)}`}
          />
        </div>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const { vendor } = useAuth();
  const [stats, setStats]     = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  useEffect(() => {
    api.getStats()
      .then(setStats)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="flex items-center justify-center h-48">
      <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (error) return (
    <div className="card flex items-center gap-3 text-red-600">
      <AlertCircle className="w-5 h-5 flex-shrink-0" /> {error}
    </div>
  );

  const { earnings, pending_orders, total_products, total_orders, recent_orders, monthly_chart } = stats || {};

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">
          Hi, {vendor?.store_name?.split(' ')[0] || 'there'} 👋
        </h1>
        <p className="text-gray-500 text-sm">Here's your store at a glance</p>
      </div>

      {/* Balance highlight */}
      <div className="brand-gradient rounded-2xl p-5 text-white">
        <p className="text-primary-100 text-xs font-medium mb-1">Available Balance</p>
        <p className="text-3xl font-bold">{fmt(earnings?.available_balance)}</p>
        <div className="flex items-center justify-between mt-3">
          <p className="text-primary-200 text-xs">{earnings?.commission_rate}% platform commission</p>
          <Link
            to="/withdrawals"
            className="bg-white/20 hover:bg-white/30 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1"
          >
            Withdraw <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
      </div>

      {/* Stats grid — 2 col on all mobile */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Net Earnings"    value={fmt(earnings?.net_earnings)}  sub={`Gross: ${fmt(earnings?.gross_sales)}`} icon={TrendingUp}  color="bg-primary-600" />
        <StatCard label="Total Orders"    value={total_orders ?? '—'}          sub={`${pending_orders ?? 0} pending`}       icon={ShoppingBag} color="bg-orange-500" />
        <StatCard label="Products"        value={total_products ?? '—'}        sub="Published"                               icon={Package}     color="bg-purple-500" />
        <StatCard label="Withdrawn"       value={fmt(earnings?.total_withdrawn)} sub="All time"                              icon={Wallet}      color="bg-green-500" />
      </div>

      {/* Chart + breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 card">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 text-sm">Net Earnings · Last 6 Months</h2>
            <Link to="/earnings" className="text-xs text-primary-600 hover:underline flex items-center gap-1">
              Details <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          {monthly_chart?.length ? (
            <>
              <MiniChart data={monthly_chart.slice(-6)} />
              <div className="flex justify-between mt-1.5">
                {monthly_chart.slice(-6).map((d: any, i: number) => (
                  <span key={i} className="text-[10px] text-gray-400">
                    {new Date(d.month).toLocaleDateString('en-GB', { month: 'short' })}
                  </span>
                ))}
              </div>
            </>
          ) : (
            <p className="text-gray-400 text-sm py-6 text-center">No earnings data yet</p>
          )}
        </div>

        <div className="card">
          <h2 className="font-semibold text-gray-900 mb-3 text-sm">Breakdown</h2>
          <div className="space-y-2">
            {[
              { label: 'Gross Sales',         value: fmt(earnings?.gross_sales),          color: 'text-gray-900' },
              { label: 'Commission',          value: `- ${fmt(earnings?.platform_commission)}`, color: 'text-red-500' },
              { label: 'Net Earnings',        value: fmt(earnings?.net_earnings),          color: 'text-green-600 font-bold' },
              { label: 'Withdrawn',           value: `- ${fmt(earnings?.total_withdrawn)}`, color: 'text-orange-500' },
              { label: 'Available',           value: fmt(earnings?.available_balance),     color: 'text-primary-600 font-bold' },
            ].map(row => (
              <div key={row.label} className="flex justify-between items-center py-1.5 border-b border-gray-50 last:border-0">
                <span className="text-xs text-gray-500">{row.label}</span>
                <span className={`text-xs ${row.color}`}>{row.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent orders — card list on all screens */}
      <div className="card p-0 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900 text-sm">Recent Orders</h2>
          <Link to="/orders" className="text-xs text-primary-600 hover:underline flex items-center gap-1">
            View all <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
        {recent_orders?.length ? (
          <div className="divide-y divide-gray-50">
            {recent_orders.map((o: any) => (
              <div key={o.order_id} className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors">
                <div className="min-w-0">
                  <p className="font-mono text-xs text-gray-500">#{o.order_number || o.order_id?.slice(0, 8)}</p>
                  <p className="text-sm font-medium text-gray-900 truncate">{o.customer || '—'}</p>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0 ml-3">
                  <span className={`badge ${STATUS_COLORS[o.status] || 'bg-gray-100 text-gray-600'}`}>
                    {o.status?.replace(/_/g, ' ')}
                  </span>
                  <p className="text-sm font-bold text-gray-900">{fmt(o.amount * (1 - (earnings?.commission_rate || 0) / 100))}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-400 text-sm text-center py-8">No orders yet</p>
        )}
      </div>
    </div>
  );
}
