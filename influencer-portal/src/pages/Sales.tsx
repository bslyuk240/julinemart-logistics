import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';

interface Sale {
  id: string;
  order_number: string;
  product_total: number;
  shipping_original_cost: number;
  shipping_discount_amount: number;
  shipping_customer_paid: number;
  influencer_commission_rate: number;
  influencer_commission_amount: number;
  commission_status: string;
  sale_date: string;
  order_status: string;
  notes: string | null;
}

const PERIODS = [
  { key: 'this_month', label: 'This Month' },
  { key: 'last_month', label: 'Last Month' },
  { key: 'all', label: 'All Time' },
];

export default function Sales() {
  const [period, setPeriod] = useState('this_month');
  const [sales, setSales] = useState<Sale[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data, count } = await api.getSales(period);
      setSales(data);
      setCount(count);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sales');
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Sales History</h1>
          <p className="text-gray-500 mt-1">Orders placed with your coupon code.</p>
        </div>
        <div className="flex gap-1.5">
          {PERIODS.map(p => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                period === p.key ? 'bg-primary-600 border-primary-600 text-white' : 'bg-white border-gray-200 text-gray-600 hover:border-primary-300'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm">{error}</div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : sales.length === 0 ? (
        <div className="card text-center text-gray-400 py-12">
          No sales recorded yet for this period.
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden sm:block card p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-left">Order #</th>
                  <th className="px-4 py-3 text-right">Product Total</th>
                  <th className="px-4 py-3 text-right">Shipping Discount</th>
                  <th className="px-4 py-3 text-right">Commission</th>
                  <th className="px-4 py-3 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sales.map(sale => (
                  <tr key={sale.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">{new Date(sale.sale_date).toLocaleDateString()}</td>
                    <td className="px-4 py-3 font-mono">{sale.order_number}</td>
                    <td className="px-4 py-3 text-right font-semibold">₦{sale.product_total.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-red-600">-₦{sale.shipping_discount_amount.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-green-600 font-semibold">₦{sale.influencer_commission_amount.toLocaleString()}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`badge ${sale.commission_status === 'paid' ? 'badge-green' : 'badge-orange'}`}>
                        {sale.commission_status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="sm:hidden space-y-2">
            {sales.map(sale => (
              <div key={sale.id} className="card">
                <div className="flex justify-between items-start gap-2">
                  <div>
                    <p className="font-mono text-sm font-semibold">#{sale.order_number}</p>
                    <p className="text-xs text-gray-400">{new Date(sale.sale_date).toLocaleDateString()}</p>
                  </div>
                  <span className={`badge ${sale.commission_status === 'paid' ? 'badge-green' : 'badge-orange'}`}>
                    {sale.commission_status}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
                  <div>
                    <p className="text-gray-400">Product Total</p>
                    <p className="font-semibold">₦{sale.product_total.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-gray-400">Your Commission</p>
                    <p className="font-semibold text-green-600">₦{sale.influencer_commission_amount.toLocaleString()}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <p className="text-xs text-gray-400 text-center">{count} sale{count === 1 ? '' : 's'} in this period</p>
        </>
      )}
    </div>
  );
}
