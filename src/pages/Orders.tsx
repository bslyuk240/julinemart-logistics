import { useEffect, useState } from 'react';
import { ShoppingBag, AlertCircle, Eye } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

const fmt = (n: number) => `₦${Number(n || 0).toLocaleString()}`;

const STATUS_BADGE: Record<string, string> = {
  pending:          'bg-yellow-100 text-yellow-700',
  assigned:         'bg-blue-100 text-blue-700',
  in_transit:       'bg-indigo-100 text-indigo-700',
  out_for_delivery: 'bg-purple-100 text-purple-700',
  delivered:        'bg-green-100 text-green-700',
  cancelled:        'bg-red-100 text-red-700',
  returned:         'bg-gray-100 text-gray-600',
};

export default function Orders() {
  const { vendor } = useAuth();
  const [data, setData]           = useState<any>(null);
  const [selected, setSelected]   = useState<any>(null);
  const [loading, setLoading]     = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError]         = useState('');
  const [statusFilter, setStatus] = useState('');
  const [page, setPage]           = useState(1);

  useEffect(() => {
    setLoading(true);
    api.getOrders({ page: String(page), ...(statusFilter && { status: statusFilter }) })
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [page, statusFilter]);

  const openDetail = async (id: string) => {
    setDetailLoading(true);
    try {
      const detail = await api.getOrder(id);
      setSelected(detail);
    } catch (e: any) { setError(e.message); }
    finally { setDetailLoading(false); }
  };

  const commissionRate = Number(vendor?.commission_rate || 0);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">My Orders</h1>

      <div className="flex gap-3">
        <select className="input w-48" value={statusFilter} onChange={e => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All Statuses</option>
          {Object.keys(STATUS_BADGE).map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </select>
      </div>

      {error && <div className="card flex items-center gap-3 text-red-600"><AlertCircle className="w-5 h-5" />{error}</div>}

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          <div className="card p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr className="text-left text-gray-500">
                  <th className="px-4 py-3 font-medium">Order</th>
                  <th className="px-4 py-3 font-medium hidden md:table-cell">Customer</th>
                  <th className="px-4 py-3 font-medium">Your Payout</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium hidden sm:table-cell">Date</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {(data?.orders || []).map((o: any) => (
                  <tr key={o.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs">#{o.order_number || o.id?.slice(0,8)}</td>
                    <td className="px-4 py-3 text-gray-600 hidden md:table-cell">{o.customer || '—'}</td>
                    <td className="px-4 py-3 font-semibold">{fmt(o.vendor_amount)}</td>
                    <td className="px-4 py-3">
                      <span className={`badge ${STATUS_BADGE[o.status] || 'bg-gray-100 text-gray-600'}`}>
                        {o.status?.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400 hidden sm:table-cell text-xs">
                      {new Date(o.created_at).toLocaleDateString('en-GB')}
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => openDetail(o.id)} className="p-1.5 text-gray-400 hover:text-primary-600 rounded">
                        <Eye className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data?.orders?.length && (
              <div className="text-center py-12 text-gray-400">
                <ShoppingBag className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>No orders found</p>
              </div>
            )}
          </div>

          {data?.total_pages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-500">{data.total} orders total</p>
              <div className="flex gap-2">
                <button className="btn-secondary text-sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</button>
                <span className="px-3 py-2 text-sm">{page} / {data.total_pages}</span>
                <button className="btn-secondary text-sm" disabled={page >= data.total_pages} onClick={() => setPage(p => p + 1)}>Next</button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Order detail modal */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h2 className="font-bold text-gray-900">Order #{selected.orders?.order_number}</h2>
              <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><p className="text-gray-500">Status</p><p className="font-medium capitalize">{selected.status?.replace(/_/g,' ')}</p></div>
                <div><p className="text-gray-500">Tracking</p><p className="font-mono text-xs">{selected.tracking_number || selected.courier_waybill || '—'}</p></div>
                <div><p className="text-gray-500">Customer</p><p className="font-medium">{selected.orders?.customer_name}</p></div>
                <div><p className="text-gray-500">Hub</p><p className="font-medium">{selected.hubs?.name}</p></div>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">Items</p>
                <div className="space-y-2">
                  {(selected.order_items || []).map((item: any) => (
                    <div key={item.id} className="flex justify-between text-sm border-b border-gray-50 pb-2">
                      <div>
                        <p>{item.product_name}</p>
                        <p className="text-xs text-gray-400">SKU: {item.product_sku} × {item.quantity}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-medium">{fmt(item.subtotal)}</p>
                        <p className="text-xs text-green-600">You get: {fmt(item.subtotal * (1 - commissionRate / 100))}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              {selected.orders?.shipping_address && (
                <div>
                  <p className="text-sm font-medium text-gray-700 mb-1">Delivery Address</p>
                  <p className="text-sm text-gray-600">{
                    typeof selected.orders.shipping_address === 'string'
                      ? selected.orders.shipping_address
                      : JSON.stringify(selected.orders.shipping_address)
                  }</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
