import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ChevronRight } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { PullToRefresh } from '../PullToRefresh';

const functionsBase = import.meta.env.VITE_NETLIFY_FUNCTIONS_BASE || '/.netlify/functions';

type ProblemRow = {
  id: string;
  reason: string | null;
  note: string | null;
  reported_at: string;
  shipment_status: string;
  tracking_number: string | null;
  order_number: string | null;
  order_id: string | null;
  manual_shipment_id: string | null;
  source_type: 'sub_order' | 'manual_shipment';
  customer_name: string | null;
  rider_name: string | null;
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

export default function MobileDeliveryProblems() {
  const { session } = useAuth();
  const notification = useNotification();
  const [rows, setRows] = useState<ProblemRow[]>([]);
  const [reasonFilter, setReasonFilter] = useState('all');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!session?.access_token) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (reasonFilter !== 'all') params.set('reason', reasonFilter);
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
  }, [notification, session?.access_token, reasonFilter]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <PullToRefresh onRefresh={load}>
      <div className="px-4 pt-4 pb-24">
        <div className="flex items-center gap-2 mb-1">
          <AlertTriangle className="w-5 h-5 text-red-600" />
          <h1 className="text-lg font-bold text-gray-900">Delivery Problems</h1>
        </div>
        <p className="text-xs text-gray-500 mb-4">Problems riders reported from the road, for triage</p>

        <div className="flex gap-2 overflow-x-auto pb-3 -mx-1 px-1">
          <button
            type="button"
            onClick={() => setReasonFilter('all')}
            className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold ${
              reasonFilter === 'all' ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-700'
            }`}
          >
            All reasons
          </button>
          {Object.entries(REASON_LABEL).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setReasonFilter(key)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold ${
                reasonFilter === key ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="py-12 text-center text-sm text-gray-500">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-500">No open reports</div>
        ) : (
          <div className="space-y-3">
            {rows.map((row) => {
              const href = detailHref(row);
              const urgent = row.reason && URGENT_REASONS.has(row.reason);
              const card = (
                <div className={`w-full text-left rounded-2xl border p-4 shadow-sm ${urgent ? 'border-red-200 bg-red-50/40' : 'border-gray-100 bg-white'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${urgent ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700'}`}>
                        {urgent && <AlertTriangle className="w-3 h-3" />}
                        {row.reason ? REASON_LABEL[row.reason] || row.reason : '—'}
                      </span>
                      <p className="font-semibold text-gray-900 mt-1.5 truncate">{row.order_number || row.tracking_number || 'Order'}</p>
                      <p className="text-xs text-gray-500 mt-0.5 truncate">
                        {row.customer_name || 'Customer'} · Rider: {row.rider_name || '—'}
                      </p>
                      {row.note && <p className="text-xs text-gray-500 mt-1">{row.note}</p>}
                      <p className="text-[11px] text-gray-400 mt-1">
                        {new Date(row.reported_at).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${STATUS_BADGE[row.shipment_status] || 'bg-gray-100 text-gray-600'}`}>
                        {row.shipment_status.replace('_', ' ')}
                      </span>
                      {href && <ChevronRight className="w-4 h-4 text-gray-300" />}
                    </div>
                  </div>
                </div>
              );
              return href ? (
                <a key={row.id} href={href} className="block">
                  {card}
                </a>
              ) : (
                <div key={row.id}>{card}</div>
              );
            })}
          </div>
        )}
      </div>
    </PullToRefresh>
  );
}
