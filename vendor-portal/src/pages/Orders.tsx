import { useEffect, useState } from 'react';
import { ShoppingBag, AlertCircle, X, ChevronRight, Truck, Printer, Download, Package } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

const JLO_API = import.meta.env.VITE_JLO_API_URL || 'https://jlo.julinemart.com';

const fmt = (n: number) => `₦${Number(n || 0).toLocaleString()}`;

const STATUS_BADGE: Record<string, string> = {
  pending:           'bg-yellow-100 text-yellow-700',
  vendor_dispatched: 'bg-amber-100 text-amber-700',
  assigned:          'bg-blue-100 text-blue-700',
  in_transit:       'bg-indigo-100 text-indigo-700',
  out_for_delivery: 'bg-purple-100 text-purple-700',
  delivered:        'bg-green-100 text-green-700',
  cancelled:        'bg-red-100 text-red-700',
  returned:         'bg-gray-100 text-gray-600',
};

export default function Orders() {
  const { vendor } = useAuth();
  const [data, setData]                   = useState<any>(null);
  const [selected, setSelected]           = useState<any>(null);
  const [loading, setLoading]             = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError]                 = useState('');
  const [statusFilter, setStatus]         = useState('');
  const [page, setPage]                   = useState(1);
  const [dispatching, setDispatching]     = useState(false);
  const [sendingToFez, setSendingToFez]   = useState(false);
  const [fezError, setFezError]           = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    api.getOrders({ page: String(page), ...(statusFilter && { status: statusFilter }) })
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [page, statusFilter]);

  const openDetail = async (id: string) => {
    setDetailLoading(true);
    setError('');
    try {
      const detail = await api.getOrder(id);
      setSelected(detail);
    } catch (e: any) { setError(e.message); }
    finally { setDetailLoading(false); }
  };

  const markDispatched = async () => {
    if (!selected || dispatching) return;
    setDispatching(true);
    try {
      const { data: { session } } = await (await import('../lib/supabase')).supabase.auth.getSession();
      const token = session?.access_token || '';
      const res = await fetch('/.netlify/functions/vendor-dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ sub_order_id: selected.id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed');
      setSelected((prev: any) => ({ ...prev, status: 'vendor_dispatched' }));
      setData((prev: any) => prev ? {
        ...prev,
        orders: prev.orders.map((o: any) => o.id === selected.id ? { ...o, status: 'vendor_dispatched' } : o),
      } : prev);
    } catch (e: any) { setError(e.message); }
    finally { setDispatching(false); }
  };

  const sendToFez = async () => {
    if (!selected || sendingToFez) return;
    setSendingToFez(true);
    setFezError('');
    try {
      const { data: { session } } = await (await import('../lib/supabase')).supabase.auth.getSession();
      const token = session?.access_token || '';
      const res = await fetch(`${JLO_API}/.netlify/functions/fez-create-shipment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ subOrderId: selected.id }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Failed to create Fez shipment');
      // Refresh order detail to get updated tracking number + status
      const updated = await api.getOrder(selected.id);
      setSelected(updated);
      setData((prev: any) => prev ? {
        ...prev,
        orders: prev.orders.map((o: any) => o.id === selected.id ? { ...o, status: updated.status } : o),
      } : prev);
    } catch (e: any) {
      setFezError(e.message || 'Failed to send to Fez. Please try again.');
    } finally {
      setSendingToFez(false);
    }
  };

  const printLabel = () => {
    if (!selected?.id) return;
    window.open(`${JLO_API}/.netlify/functions/generate-label?subOrderId=${selected.id}&print=true`, '_blank');
  };

  const downloadWaybill = async () => {
    if (!selected?.id) return;
    const { data: { session } } = await (await import('../lib/supabase')).supabase.auth.getSession();
    const token = session?.access_token || '';
    const res = await fetch(`${JLO_API}/.netlify/functions/generate-waybill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ subOrderId: selected.id }),
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `waybill-${selected.id}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const fezCollectionMethod = vendor?.fez_collection_method || 'hub_dropoff';
  const commissionRate = Number(vendor?.commission_rate || 0);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-gray-900">My Orders</h1>

      {/* Status filter — full width scrollable chips on mobile */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 lg:mx-0 lg:px-0 scrollbar-none">
        {['', ...Object.keys(STATUS_BADGE)].map(s => (
          <button
            key={s}
            onClick={() => { setStatus(s); setPage(1); }}
            className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
              statusFilter === s
                ? 'bg-primary-600 text-white border-primary-600'
                : 'bg-white text-gray-600 border-gray-300'
            }`}
          >
            {s ? s.replace(/_/g, ' ') : 'All'}
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
          {/* Mobile: card list */}
          <div className="space-y-3 lg:hidden">
            {(data?.orders || []).map((o: any) => (
              <button
                key={o.id}
                onClick={() => openDetail(o.id)}
                className="w-full card p-0 overflow-hidden text-left hover:shadow-md active:scale-[0.99] transition-all"
              >
                <div className="flex items-center gap-3 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-mono text-xs text-gray-400">#{o.order_number || o.id?.slice(0, 8)}</span>
                      <span className={`badge ${STATUS_BADGE[o.status] || 'bg-gray-100 text-gray-600'}`}>
                        {o.status?.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <p className="text-sm font-semibold text-gray-900 truncate">{o.customer || 'Customer'}</p>
                    <p className="text-xs text-gray-400">{new Date(o.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <div className="text-right">
                      <p className="text-sm font-bold text-gray-900">{fmt(o.vendor_amount)}</p>
                      <p className="text-xs text-green-600">Your payout</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-gray-400" />
                  </div>
                </div>
              </button>
            ))}
          </div>

          {/* Desktop: table */}
          {(data?.orders || []).length > 0 && (
            <div className="hidden lg:block card p-0 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
                  <tr>
                    <th className="px-5 py-3 text-left">Order #</th>
                    <th className="px-5 py-3 text-left">Customer</th>
                    <th className="px-5 py-3 text-left">Status</th>
                    <th className="px-5 py-3 text-left">Date</th>
                    <th className="px-5 py-3 text-right">Gross</th>
                    <th className="px-5 py-3 text-right">Your Payout</th>
                    <th className="px-5 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {(data?.orders || []).map((o: any) => (
                    <tr key={o.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => openDetail(o.id)}>
                      <td className="px-5 py-3 font-mono text-xs text-gray-500">#{o.order_number || o.id?.slice(0, 8)}</td>
                      <td className="px-5 py-3 font-medium text-gray-900">{o.customer || '—'}</td>
                      <td className="px-5 py-3">
                        <span className={`badge ${STATUS_BADGE[o.status] || 'bg-gray-100 text-gray-600'}`}>
                          {o.status?.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-gray-500 text-xs">{new Date(o.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                      <td className="px-5 py-3 text-right text-gray-700">{fmt(o.gross_amount)}</td>
                      <td className="px-5 py-3 text-right font-bold text-gray-900">{fmt(o.vendor_amount)}</td>
                      <td className="px-5 py-3 text-right"><ChevronRight className="w-4 h-4 text-gray-400 ml-auto" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!data?.orders?.length && (
            <div className="card text-center py-16 text-gray-400">
              <ShoppingBag className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No orders found</p>
              <p className="text-sm mt-1">Orders will appear here once customers place them</p>
            </div>
          )}

          {/* Pagination */}
          {data?.total_pages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <p className="text-sm text-gray-500">{data.total} orders</p>
              <div className="flex gap-2">
                <button className="btn-secondary btn-sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
                <span className="flex items-center px-3 text-sm text-gray-600">{page}/{data.total_pages}</span>
                <button className="btn-secondary btn-sm" disabled={page >= data.total_pages} onClick={() => setPage(p => p + 1)}>Next →</button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Order detail — full-screen on mobile, modal on desktop */}
      {(selected || detailLoading) && (
        <div className="fixed inset-0 z-50 lg:flex lg:items-center lg:justify-center lg:p-4 lg:bg-black/40">
          <div className="bg-white lg:rounded-2xl lg:shadow-2xl w-full h-full lg:h-auto lg:max-w-lg lg:max-h-[90vh] flex flex-col">

            {/* Header */}
            <div className="flex items-center justify-between px-4 py-4 border-b border-gray-100 flex-shrink-0">
              <div>
                <h2 className="font-bold text-gray-900">
                  {selected ? `Order #${selected.orders?.order_number}` : 'Loading…'}
                </h2>
                {selected && (
                  <span className={`badge mt-1 ${STATUS_BADGE[selected.status] || 'bg-gray-100 text-gray-600'}`}>
                    {selected.status?.replace(/_/g, ' ')}
                  </span>
                )}
              </div>
              <button
                onClick={() => setSelected(null)}
                className="p-2 rounded-xl hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {detailLoading ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : selected && (
              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">

                {/* Order meta */}
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: 'Customer',   value: selected.orders?.customer_name },
                    { label: 'Hub',        value: selected.hubs?.name },
                    { label: 'Tracking',   value: selected.tracking_number || selected.courier_waybill || '—' },
                    { label: 'Date',       value: selected.created_at ? new Date(selected.created_at).toLocaleDateString('en-GB') : '—' },
                  ].map(f => (
                    <div key={f.label} className="bg-gray-50 rounded-xl p-3">
                      <p className="text-xs text-gray-500 mb-0.5">{f.label}</p>
                      <p className="text-sm font-semibold text-gray-900 break-all">{f.value || '—'}</p>
                    </div>
                  ))}
                </div>

                {/* Items */}
                <div>
                  <p className="text-sm font-semibold text-gray-700 mb-2">Items</p>
                  <div className="space-y-2">
                    {(selected.order_items || []).map((item: any) => {
                      const vd = item.variation_details
                        ? (typeof item.variation_details === 'string' ? JSON.parse(item.variation_details) : item.variation_details)
                        : null;
                      const rawAttrs = vd?.attributes ?? null;
                      const vars: string[] = rawAttrs == null ? [] : Array.isArray(rawAttrs)
                        ? rawAttrs.map((a: any) => {
                            const name = a?.name || a?.attribute || a?.label || '';
                            const val  = a?.option ?? a?.value ?? a?.option_value;
                            if (name && val != null && val !== '') return `${name}: ${val}`;
                            if (val != null && val !== '') return String(val);
                            return name ? String(name) : '';
                          }).filter(Boolean)
                        : Object.entries(rawAttrs)
                            .map(([k, v]) => (v != null && String(v) !== '' ? `${k}: ${v}` : ''))
                            .filter(Boolean);
                      return (
                      <div key={item.id} className="bg-gray-50 rounded-xl p-3 flex justify-between items-start gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900">{item.product_name}</p>
                          {vars.length > 0 && (
                            <p className="text-xs text-purple-600 font-medium mt-0.5">
                              {vars.join(' · ')}
                            </p>
                          )}
                          <p className="text-xs text-gray-400 mt-0.5">SKU: {item.product_sku} · Qty: {item.quantity}</p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-sm font-bold text-gray-900">{fmt(item.subtotal)}</p>
                          <p className="text-xs text-green-600">You: {fmt(item.subtotal * (1 - commissionRate / 100))}</p>
                        </div>
                      </div>
                      );
                    })}
                  </div>
                </div>

                {/* Send to Fez CTA — visible when pending and no tracking yet */}
                {selected.status === 'pending' && !selected.tracking_number && (
                  <div className="space-y-2">
                    <button
                      onClick={sendToFez}
                      disabled={sendingToFez}
                      className="w-full flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-60 text-white font-semibold py-3 rounded-xl transition-colors"
                    >
                      <Package className="w-4 h-4" />
                      {sendingToFez ? 'Creating Fez shipment…' : 'Send to Fez'}
                    </button>
                    {fezError && (
                      <p className="text-xs text-red-600 text-center">{fezError}</p>
                    )}
                  </div>
                )}

                {/* After Fez shipment created — label, waybill, collection instructions */}
                {selected.tracking_number && (
                  <div className="space-y-3">
                    {/* Tracking info */}
                    <div className="bg-purple-50 border border-purple-200 rounded-xl p-3 flex items-center justify-between">
                      <div>
                        <p className="text-xs text-purple-600 font-medium">Fez Tracking Number</p>
                        <p className="text-sm font-bold text-purple-900 font-mono">{selected.tracking_number}</p>
                      </div>
                      {selected.courier_tracking_url && (
                        <a href={selected.courier_tracking_url} target="_blank" rel="noreferrer"
                          className="text-xs text-purple-600 underline">Track</a>
                      )}
                    </div>

                    {/* Print label + download waybill */}
                    <div className="grid grid-cols-2 gap-2">
                      <button onClick={printLabel}
                        className="flex items-center justify-center gap-2 border border-gray-300 text-gray-700 text-sm font-medium py-2.5 rounded-xl hover:bg-gray-50 transition">
                        <Printer className="w-4 h-4" /> Print Label
                      </button>
                      <button onClick={downloadWaybill}
                        className="flex items-center justify-center gap-2 border border-gray-300 text-gray-700 text-sm font-medium py-2.5 rounded-xl hover:bg-gray-50 transition">
                        <Download className="w-4 h-4" /> Waybill PDF
                      </button>
                    </div>

                    {/* Collection instruction card */}
                    {fezCollectionMethod === 'fez_pickup' ? (
                      <div className="bg-green-50 border border-green-200 rounded-xl p-3 flex gap-3 items-start">
                        <Truck className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="text-sm font-semibold text-green-800">Fez will come to your shop</p>
                          <p className="text-xs text-green-700 mt-0.5">
                            Stick the label on the package and have it ready at your business address.
                            A Fez rider will pick it up shortly.
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex gap-3 items-start">
                        <Truck className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                        <div>
                          {(() => {
                            const jloHub = vendor?.approved_vendor_locations?.hubs;
                            const hubName = jloHub?.name || vendor?.approved_vendor_locations?.fez_hub_name;
                            const hubAddress = jloHub?.address || vendor?.approved_vendor_locations?.fez_hub_address;
                            const isJloHub = !!jloHub?.name;
                            return (
                              <>
                                <p className="text-sm font-semibold text-amber-800">
                                  Drop off at {isJloHub ? 'JulineMart hub' : 'Fez hub'}
                                </p>
                                <p className="text-xs text-amber-700 mt-0.5">
                                  Stick the label on the package and drop it at{' '}
                                  {isJloHub ? 'the JulineMart hub' : 'your nearest Fez collection hub'}.
                                  {hubName && ` Hub: ${hubName}`}
                                  {hubAddress && ` — ${hubAddress}.`}
                                </p>
                              </>
                            );
                          })()}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Payout summary */}
                <div className="bg-primary-50 rounded-xl p-4">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-xs text-primary-600 font-medium">Your Payout</p>
                      <p className="text-xs text-gray-500">After {commissionRate}% commission</p>
                    </div>
                    <p className="text-2xl font-bold text-primary-700">{fmt(selected.vendor_amount)}</p>
                  </div>
                </div>

                {/* Delivery address */}
                {selected.orders?.delivery_address && (
                  <div>
                    <p className="text-sm font-semibold text-gray-700 mb-1">Delivery Address</p>
                    <p className="text-sm text-gray-600 bg-gray-50 rounded-xl p-3">
                      {typeof selected.orders.delivery_address === 'string'
                        ? selected.orders.delivery_address
                        : JSON.stringify(selected.orders.delivery_address)}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
