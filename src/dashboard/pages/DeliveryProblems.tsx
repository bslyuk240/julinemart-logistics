import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ExternalLink, RefreshCw } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useNotification } from '../contexts/NotificationContext';

const functionsBase = import.meta.env.VITE_NETLIFY_FUNCTIONS_BASE || '/.netlify/functions';

type ProblemRow = {
  id: string;
  reason: string | null;
  note: string | null;
  description: string;
  reported_at: string;
  shipment_status: string;
  tracking_number: string | null;
  order_number: string | null;
  order_id: string | null;
  manual_shipment_id: string | null;
  source_type: 'sub_order' | 'manual_shipment';
  customer_name: string | null;
  customer_phone: string | null;
  rider_name: string | null;
  rider_phone: string | null;
};

const REASON_LABEL: Record<string, string> = {
  vendor_not_ready: 'Vendor not ready',
  vendor_closed: 'Vendor closed',
  package_unavailable: 'Package unavailable',
  wrong_address: 'Wrong address',
  customer_unreachable: 'Customer unreachable',
  customer_refused: 'Customer refused delivery',
  package_damaged: 'Package damaged',
  vehicle_breakdown: 'Vehicle breakdown',
  safety_issue: 'Safety issue',
  other: 'Other',
};

const URGENT_REASONS = new Set(['safety_issue', 'vehicle_breakdown']);

const STATUS_BADGE: Record<string, string> = {
  assigned: 'bg-blue-100 text-blue-800',
  picked_up: 'bg-indigo-100 text-indigo-800',
  out_for_delivery: 'bg-amber-100 text-amber-800',
  delivered: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-700',
  returned: 'bg-gray-100 text-gray-600',
};

function detailHref(row: ProblemRow) {
  if (row.source_type === 'sub_order' && row.order_id) return `/admin/orders/${row.order_id}`;
  if (row.source_type === 'manual_shipment' && row.manual_shipment_id) return `/admin/manual-shipments/${row.manual_shipment_id}`;
  return null;
}

export default function DeliveryProblemsPage() {
  const { session } = useAuth();
  const notification = useNotification();
  const [rows, setRows] = useState<ProblemRow[]>([]);
  const [reasonFilter, setReasonFilter] = useState<string>('all');
  const [includeClosed, setIncludeClosed] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!session?.access_token) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (reasonFilter !== 'all') params.set('reason', reasonFilter);
      if (includeClosed) params.set('include_closed', 'true');
      const res = await fetch(`${functionsBase}/admin-delivery-problems?${params}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || 'Failed to load reports');
      setRows(payload.data || []);
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Failed to load reports');
    } finally {
      setLoading(false);
    }
  }, [notification, session?.access_token, reasonFilter, includeClosed]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="w-full max-w-none px-4 sm:px-6 xl:px-8 py-4 md:py-6">
      <div className="flex items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-8 h-8 text-red-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Delivery Problems</h1>
            <p className="text-sm text-gray-600">Problems riders reported from the road, for triage.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={load}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm hover:bg-gray-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button
          type="button"
          onClick={() => setReasonFilter('all')}
          className={`px-3 py-1.5 rounded-full text-sm font-medium ${
            reasonFilter === 'all' ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          All reasons
        </button>
        {Object.entries(REASON_LABEL).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setReasonFilter(key)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium ${
              reasonFilter === key ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {label}
          </button>
        ))}
        <label className="ml-auto inline-flex items-center gap-1.5 text-sm text-gray-600">
          <input type="checkbox" checked={includeClosed} onChange={(e) => setIncludeClosed(e.target.checked)} />
          Include delivered/failed/returned
        </label>
      </div>

      <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-600">
              <tr>
                <th className="px-4 py-3 font-medium">Reported</th>
                <th className="px-4 py-3 font-medium">Reason</th>
                <th className="px-4 py-3 font-medium">Order</th>
                <th className="px-4 py-3 font-medium">Customer</th>
                <th className="px-4 py-3 font-medium">Rider</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Open</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">No open reports</td></tr>
              ) : (
                rows.map((row) => {
                  const href = detailHref(row);
                  const urgent = row.reason && URGENT_REASONS.has(row.reason);
                  return (
                    <tr key={row.id} className={`border-t ${urgent ? 'bg-red-50/40' : ''}`}>
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                        {new Date(row.reported_at).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${urgent ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700'}`}>
                          {urgent && <AlertTriangle className="w-3 h-3" />}
                          {row.reason ? REASON_LABEL[row.reason] || row.reason : '—'}
                        </span>
                        {row.note && <p className="text-xs text-gray-500 mt-1 max-w-xs">{row.note}</p>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{row.order_number || row.tracking_number || '—'}</div>
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        <div>{row.customer_name || '—'}</div>
                        {row.customer_phone && <div className="text-xs text-gray-400">{row.customer_phone}</div>}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        <div>{row.rider_name || '—'}</div>
                        {row.rider_phone && <div className="text-xs text-gray-400">{row.rider_phone}</div>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[row.shipment_status] || 'bg-gray-100 text-gray-600'}`}>
                          {row.shipment_status.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {href ? (
                          <a href={href} className="inline-flex items-center gap-1 text-primary-700 hover:underline text-xs font-medium">
                            View <ExternalLink className="w-3 h-3" />
                          </a>
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
