import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { TrendingUp, ShoppingBag, Package, Wallet, ArrowRight, AlertCircle } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

const fmt = (n: number) => `₦${Number(n || 0).toLocaleString()}`;

function StatCard({ label, value, sub, icon: Icon, color }: any) {
  return (
    <div className="card flex items-start gap-4">
      <div className={`p-3 rounded-xl ${color}`}>
        <Icon className="w-6 h-6 text-white" />
      </div>
      <div>
        <p className="text-sm text-gray-500">{label}</p>
        <p className="text-2xl font-bold text-gray-900 mt-0.5">{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function MiniChart({ data }: { data: { month: string; net_earnings: number }[] }) {
  if (!data.length) return null;
  const max = Math.max(...data.map(d => d.net_earnings), 1);
  return (
    <div className="flex items-end gap-1 h-16">
      {data.map((d, i) => (
        <div key={i} className="flex-1 flex flex-col items-center gap-1">
          <div
            className="w-full bg-primary-500 rounded-t opacity-80 hover:opacity-100 transition-opacity"
            style={{ height: `${Math.max(4, (d.net_earnings / max) * 56)}px` }}
            title={`${new Date(d.month).toLocaleDateString('en-GB', { month: 'short' })}: ${fmt(d.net_earnings)}`}
          />
        </div>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const { vendor } = useAuth();
  const [stats, setStats]   = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState('');

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
      <AlertCircle className="w-5 h-5" /> {error}
    </div>
  );

  const { earnings, pending_orders, total_products, total_orders, recent_orders, monthly_chart } = stats || {};

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Welcome back, {vendor?.store_name}</h1>
        <p className="text-gray-500 text-sm mt-1">Here's how your store is performing</p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard label="Available Balance"    value={fmt(earnings?.available_balance)} sub={`${earnings?.commission_rate}% platform fee`} icon={Wallet}      color="bg-green-500" />
        <StatCard label="Net Earnings (Total)" value={fmt(earnings?.net_earnings)}      sub={`Gross: ${fmt(earnings?.gross_sales)}`}        icon={TrendingUp}  color="bg-primary-600" />
        <StatCard label="Total Orders"         value={total_orders}                     sub={`${pending_orders} pending`}                   icon={ShoppingBag} color="bg-orange-500" />
        <StatCard label="Active Products"      value={total_products}                   sub="Published in store"                             icon={Package}     color="bg-purple-500" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Earnings chart */}
        <div className="lg:col-span-2 card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">Net Earnings — Last 6 Months</h2>
            <Link to="/earnings" className="text-sm text-primary-600 hover:underline flex items-center gap-1">
              View details <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          {monthly_chart?.length ? (
            <>
              <MiniChart data={monthly_chart.slice(-6)} />
              <div className="flex justify-between mt-2">
                {monthly_chart.slice(-6).map((d: any, i: number) => (
                  <span key={i} className="text-xs text-gray-400">
                    {new Date(d.month).toLocaleDateString('en-GB', { month: 'short' })}
                  </span>
                ))}
              </div>
            </>
          ) : (
            <p className="text-gray-400 text-sm py-8 text-center">No earnings data yet</p>
          )}
        </div>

        {/* Earnings breakdown */}
        <div className="card">
          <h2 className="font-semibold text-gray-900 mb-4">Earnings Breakdown</h2>
          <div className="space-y-3">
            {[
              { label: 'Gross Sales',          value: fmt(earnings?.gross_sales),        color: 'text-gray-900' },
              { label: 'Platform Commission',  value: `- ${fmt(earnings?.platform_commission)}`, color: 'text-red-500' },
              { label: 'Your Net Earnings',    value: fmt(earnings?.net_earnings),        color: 'text-green-600 font-bold' },
              { label: 'Total Withdrawn',      value: `- ${fmt(earnings?.total_withdrawn)}`,   color: 'text-orange-500' },
              { label: 'Available Balance',    value: fmt(earnings?.available_balance),   color: 'text-primary-600 font-bold text-lg' },
            ].map(row => (
              <div key={row.label} className="flex justify-between items-center py-1.5 border-b border-gray-50 last:border-0">
                <span className="text-sm text-gray-600">{row.label}</span>
                <span className={`text-sm ${row.color}`}>{row.value}</span>
              </div>
            ))}
          </div>
          <Link to="/withdrawals" className="btn-primary w-full mt-4 text-center text-sm block">
            Request Withdrawal
          </Link>
        </div>
      </div>

      {/* Recent orders */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-900">Recent Orders</h2>
          <Link to="/orders" className="text-sm text-primary-600 hover:underline flex items-center gap-1">
            View all <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
        {recent_orders?.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-100">
                  <th className="pb-2 font-medium">Order</th>
                  <th className="pb-2 font-medium">Customer</th>
                  <th className="pb-2 font-medium">Your Earnings</th>
                  <th className="pb-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {recent_orders.map((o: any) => (
                  <tr key={o.order_id} className="hover:bg-gray-50">
                    <td className="py-2.5 font-mono text-xs">#{o.order_number || o.order_id?.slice(0, 8)}</td>
                    <td className="py-2.5 text-gray-600">{o.customer || '—'}</td>
                    <td className="py-2.5 font-medium">{fmt(o.amount * (1 - (earnings?.commission_rate || 0) / 100))}</td>
                    <td className="py-2.5">
                      <span className={`badge ${o.status === 'delivered' ? 'bg-green-100 text-green-700' : o.status === 'processing' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                        {o.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-gray-400 text-sm text-center py-6">No orders yet</p>
        )}
      </div>
    </div>
  );
}
