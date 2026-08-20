import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, CheckCircle2, Package, Phone, RefreshCw, RotateCcw, X, XCircle } from 'lucide-react';
import { api, ActivityDetail, ActivityItem, ActivityStatus, ActivityStatusFilter } from '../lib/api';
import { BottomNav } from '../components/BottomNav';

function formatNaira(amount: number) {
  return `₦${amount.toLocaleString('en-NG', { maximumFractionDigits: 0 })}`;
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

const FILTERS: { key: ActivityStatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'In progress' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'failed', label: 'Failed' },
  { key: 'returned', label: 'Returned' },
];

const STATUS_LABEL: Record<ActivityStatus, string> = {
  assigned: 'Assigned',
  picked_up: 'Picked up',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  failed: 'Failed',
  returned: 'Returned',
};

const STATUS_ICON: Record<ActivityStatus, typeof CheckCircle2> = {
  assigned: Package,
  picked_up: Package,
  out_for_delivery: Package,
  delivered: CheckCircle2,
  failed: XCircle,
  returned: RotateCcw,
};

const STATUS_CLASS: Record<ActivityStatus, string> = {
  assigned: 'bg-blue-100 text-blue-700',
  picked_up: 'bg-indigo-100 text-indigo-700',
  out_for_delivery: 'bg-amber-100 text-amber-700',
  delivered: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-red-100 text-red-700',
  returned: 'bg-gray-100 text-gray-600',
};

const ACTIVE_STATUSES = new Set<ActivityStatus>(['assigned', 'picked_up', 'out_for_delivery']);

const DETAIL_TIMELINE: { key: keyof ActivityDetail; label: string }[] = [
  { key: 'assigned_at', label: 'Assigned' },
  { key: 'picked_up_at', label: 'Picked up' },
  { key: 'out_for_delivery_at', label: 'Out for delivery' },
  { key: 'delivered_at', label: 'Delivered' },
  { key: 'failed_at', label: 'Failed' },
];

export default function Activity() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<ActivityStatusFilter>('all');
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [detail, setDetail] = useState<ActivityDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const load = useCallback(async (status: ActivityStatusFilter) => {
    setLoading(true);
    try {
      const data = await api.getActivity(status);
      setItems(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load activity');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(filter);
  }, [filter, load]);

  const openItem = async (item: ActivityItem) => {
    // Still-in-progress deliveries are the rider's one active job — there's
    // nothing to "view" separately from just continuing it.
    if (ACTIVE_STATUSES.has(item.status)) {
      navigate('/delivery');
      return;
    }

    setSheetOpen(true);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const data = await api.getActivityDetail(item.id);
      setDetail(data);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : 'Could not load this delivery');
    } finally {
      setDetailLoading(false);
    }
  };

  const closeSheet = () => {
    setSheetOpen(false);
    setDetail(null);
    setDetailError(null);
  };

  return (
    <div className="min-h-screen pb-24">
      <div className="px-6 pt-4 pb-4 bg-white border-b border-gray-100 flex items-center gap-3">
        <button type="button" onClick={() => navigate('/')} className="text-gray-400">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-base font-bold text-gray-900">Activity</h1>
      </div>

      <div className="px-6 pt-4">
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold ${
                filter === f.key ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-700'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-6 pt-4 space-y-3">
        {error && <p className="text-sm text-red-600">{error}</p>}

        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="rounded-2xl border border-gray-200 p-4 flex items-start gap-3">
                <div className="skeleton w-9 h-9 rounded-xl shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="skeleton h-4 w-28" />
                    <div className="skeleton h-4 w-14" />
                  </div>
                  <div className="skeleton h-3 w-36" />
                  <div className="skeleton h-4 w-20 rounded-full" />
                </div>
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-300 p-6 text-center">
            <Package className="w-6 h-6 text-gray-300 mx-auto mb-2" />
            <p className="text-sm font-semibold text-gray-900">Nothing here yet</p>
            <p className="mt-1 text-xs text-gray-500">Deliveries in this filter will show up here.</p>
          </div>
        ) : (
          items.map((item) => {
            const Icon = STATUS_ICON[item.status];
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => openItem(item)}
                className="w-full text-left rounded-2xl border border-gray-200 p-4 flex items-start gap-3 active:bg-gray-50"
              >
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${STATUS_CLASS[item.status]}`}>
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-gray-900 truncate">
                      {item.tracking_number || `Order ${item.order_number ?? ''}`}
                    </p>
                    <p className="text-sm font-bold text-gray-900 shrink-0">{formatNaira(item.fee)}</p>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5 truncate">
                    {item.customer_name || 'Customer'}{item.dropoff_city ? ` · ${item.dropoff_city}` : ''}
                  </p>
                  <div className="flex items-center justify-between mt-1.5">
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${STATUS_CLASS[item.status]}`}>
                      {STATUS_LABEL[item.status]}
                    </span>
                    <span className="text-[11px] text-gray-400">
                      {new Date(item.timestamp).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })}
                    </span>
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>

      {sheetOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
          <div
            className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm max-h-[85vh] overflow-y-auto overscroll-contain p-6"
            style={{ WebkitOverflowScrolling: 'touch' }}
          >
            {/* Photo evidence renders as a bounded thumbnail (not full-bleed) — an
                unconstrained delivery photo used to eat almost the whole 85vh sheet on
                mobile, leaving no room to see (or scroll to) the rest of the details. Tap
                to view full-size instead of losing that space permanently. */}
            <div className="flex items-start justify-between gap-3 mb-4">
              <h3 className="text-base font-bold text-gray-900">Delivery details</h3>
              <button type="button" onClick={closeSheet} className="text-gray-400">
                <X className="w-5 h-5" />
              </button>
            </div>

            {detailLoading && (
              <div className="flex items-center justify-center py-10 text-gray-400">
                <RefreshCw className="w-5 h-5 animate-spin" />
              </div>
            )}

            {detailError && <p className="text-sm text-red-600">{detailError}</p>}

            {detail && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">
                      {detail.tracking_number || `Order ${detail.order_number ?? ''}`}
                    </p>
                    <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${STATUS_CLASS[detail.status]}`}>
                      {STATUS_LABEL[detail.status]}
                    </span>
                  </div>
                  <p className="text-lg font-bold text-gray-900">{formatNaira(detail.fee)}</p>
                </div>

                {detail.delivery_proof_url && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">Proof of delivery</p>
                    <button type="button" onClick={() => setLightboxUrl(detail.delivery_proof_url)} className="block w-full">
                      <img
                        src={detail.delivery_proof_url}
                        alt="Delivery proof"
                        className="w-full h-56 object-cover rounded-xl border border-gray-200"
                      />
                    </button>
                  </div>
                )}

                {detail.signature_url && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">Customer signature</p>
                    <button type="button" onClick={() => setLightboxUrl(detail.signature_url)} className="block w-full">
                      <img
                        src={detail.signature_url}
                        alt="Customer signature"
                        className="w-full h-40 object-contain rounded-xl border border-gray-200 bg-white"
                      />
                    </button>
                  </div>
                )}

                <div className="rounded-xl border border-gray-200 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Deliver to</p>
                  <p className="text-sm font-medium text-gray-900 mt-0.5">{detail.dropoff.customer_name || 'Customer'}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{detail.dropoff.address || '—'}</p>
                  {detail.dropoff.customer_phone && (
                    <a href={`tel:${detail.dropoff.customer_phone}`} className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-primary-600">
                      <Phone className="w-3 h-3" /> {detail.dropoff.customer_phone}
                    </a>
                  )}
                </div>

                <div className="rounded-xl border border-gray-200 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">From</p>
                  <p className="text-sm font-medium text-gray-900 mt-0.5">{detail.pickup.name || 'JulineMart'}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{detail.pickup.address || '—'}</p>
                </div>

                <div className="rounded-xl border border-gray-200 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-2">Timeline</p>
                  <div className="space-y-2">
                    {DETAIL_TIMELINE.filter((step) => detail[step.key]).map((step) => (
                      <div key={step.key} className="flex items-center justify-between">
                        <span className="text-xs font-medium text-gray-900 flex items-center gap-1.5">
                          <Check className="w-3 h-3 text-emerald-600" />
                          {step.label}
                        </span>
                        <span className="text-[11px] text-gray-400">{formatDateTime(detail[step.key] as string)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {lightboxUrl && (
        <div
          className="fixed inset-0 bg-black/90 flex items-center justify-center z-[60] p-4"
          onClick={() => setLightboxUrl(null)}
        >
          <button
            type="button"
            onClick={() => setLightboxUrl(null)}
            aria-label="Close image"
            className="absolute top-4 right-4 flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white"
          >
            <X className="h-4 w-4" />
          </button>
          <img src={lightboxUrl} alt="Full size evidence" className="max-w-full max-h-full object-contain rounded-lg" />
        </div>
      )}

      <BottomNav />
    </div>
  );
}
