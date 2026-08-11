import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  ExternalLink,
  Home,
  Loader,
  Mail,
  Package,
  Phone,
  RefreshCw,
  Truck,
} from 'lucide-react';
import { ShipmentTrackingEvents } from '../../../shared/ShipmentTrackingEvents';
import { TrackingTimeline, trackingVariantForShipment } from '../../../shared/TrackingTimeline';
import { customerBaseFromPath } from '../lib/nav';
import {
  deriveDisplayStatus,
  fetchTrackedOrder,
  formatNaira,
  getCourierTrackingUrl,
  getReturnTrackingUrl,
  statusPillClass,
  type Order,
} from '../lib/tracking';

export default function MobileOrderTracking() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { id: routeOrderId } = useParams<{ id?: string }>();
  const location = useLocation();
  const base = customerBaseFromPath(location.pathname);
  const homePath = base || '/';

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const orderNumber = searchParams.get('order');
  const email = searchParams.get('email');
  const displayOrderNumber =
    order?.order_number ?? order?.woocommerce_order_id ?? orderNumber ?? routeOrderId ?? '';

  useEffect(() => {
    if (routeOrderId && !orderNumber) {
      const params = new URLSearchParams(searchParams);
      params.set('order', routeOrderId);
      setSearchParams(params, { replace: true });
    }
  }, [routeOrderId, orderNumber, searchParams, setSearchParams]);

  const loadOrder = useCallback(
    async (isRefresh = false) => {
      if (!orderNumber || !email) {
        setError('Missing order number or email');
        setLoading(false);
        return;
      }

      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError('');

      try {
        const data = await fetchTrackedOrder(orderNumber, email);
        setOrder(data);
      } catch (err) {
        setOrder(null);
        setError(err instanceof Error ? err.message : 'Failed to fetch order');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [orderNumber, email],
  );

  useEffect(() => {
    loadOrder();
  }, [loadOrder]);

  if (loading) {
    return (
      <div className="flex min-h-[50dvh] items-center justify-center p-6">
        <div className="text-center">
          <Loader className="mx-auto mb-3 h-8 w-8 animate-spin text-primary-600" />
          <p className="text-sm text-gray-600">Loading your order…</p>
        </div>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="p-4">
        <button
          type="button"
          onClick={() => navigate(homePath)}
          className="mb-4 flex items-center gap-2 text-sm text-gray-600"
        >
          <ArrowLeft className="h-5 w-5" />
          Back
        </button>
        <div className="rounded-2xl bg-white p-6 text-center shadow-sm">
          <AlertCircle className="mx-auto mb-3 h-10 w-10 text-red-500" />
          <p className="text-lg font-semibold text-gray-900">Order not found</p>
          <p className="mt-2 text-sm text-gray-600">{error || 'Check your order number and email.'}</p>
          <button
            type="button"
            onClick={() => navigate(homePath)}
            className="mt-5 w-full rounded-xl bg-primary-600 py-3.5 text-sm font-semibold text-white"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  const displayStatus = deriveDisplayStatus(order);

  return (
    <div className="pb-6">
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-gray-100 bg-white/95 px-4 py-3 backdrop-blur">
        <button type="button" onClick={() => navigate(homePath)} aria-label="Back" className="shrink-0 text-gray-500">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-gray-900">Order #{displayOrderNumber}</p>
          <p className="truncate text-[11px] text-gray-400">{order.customer_name}</p>
        </div>
        <button
          type="button"
          onClick={() => loadOrder(true)}
          disabled={refreshing}
          aria-label="Refresh"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-gray-200 text-gray-600 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <section className="border-b border-gray-100 bg-white px-4 py-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase ${statusPillClass(displayStatus)}`}>
            {displayStatus.replace(/_/g, ' ')}
          </span>
        </div>
        <p className="mt-3 text-xs text-gray-500">
          Placed{' '}
          {new Date(order.created_at).toLocaleDateString('en-NG', {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Subtotal</p>
            <p className="font-semibold text-gray-900">
              ₦{formatNaira((order.total_amount ?? 0) - (order.shipping_fee_paid ?? 0))}
            </p>
          </div>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Total</p>
            <p className="font-semibold text-primary-600">₦{formatNaira(order.total_amount)}</p>
          </div>
        </div>
      </section>

      <section className="mx-4 mt-4 rounded-2xl bg-white p-4 shadow-sm">
        <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Delivery</p>
        <p className="mt-1 text-sm font-medium text-gray-900">{order.delivery_address}</p>
        <p className="text-sm text-gray-600">
          {order.delivery_city}, {order.delivery_state}
        </p>
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-gray-600">
          <span className="flex items-center gap-1">
            <Mail className="h-3.5 w-3.5" />
            {order.customer_email}
          </span>
          <span className="flex items-center gap-1">
            <Phone className="h-3.5 w-3.5" />
            {order.customer_phone}
          </span>
        </div>
      </section>

      <div className="mx-4 mt-4 space-y-4">
        <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
          Shipments ({order.sub_orders.length})
        </p>

        {order.sub_orders.map((subOrder, index) => {
          const trackingUrl = getCourierTrackingUrl(subOrder);
          const isLocalRider = subOrder.couriers?.code?.toLowerCase() === 'local_rider';

          return (
            <div key={subOrder.id} className="rounded-2xl bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900">
                    Shipment {index + 1} · {subOrder.hubs.name}
                  </p>
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-gray-500">
                    <Truck className="h-3.5 w-3.5" />
                    {subOrder.couriers.name}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${statusPillClass(subOrder.status)}`}>
                  {subOrder.status.replace(/_/g, ' ')}
                </span>
              </div>

              <div className="mt-3 rounded-xl bg-gray-50 p-3">
                <p className="text-[11px] text-gray-500">Tracking number</p>
                <p className="font-mono text-sm font-bold text-gray-900 break-all">{subOrder.tracking_number}</p>
                {subOrder.estimated_delivery_date && (
                  <p className="mt-1 text-xs text-gray-500">
                    Est. delivery{' '}
                    {new Date(subOrder.estimated_delivery_date).toLocaleDateString('en-NG', {
                      day: 'numeric',
                      month: 'short',
                    })}
                  </p>
                )}
              </div>

              <div className="mt-3">
                <TrackingTimeline
                  status={subOrder.status}
                  variant={trackingVariantForShipment({ isLocalRider })}
                  layout="compact"
                />
              </div>

              {trackingUrl && (
                <a
                  href={trackingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-primary-200 bg-primary-50 py-3 text-sm font-semibold text-primary-700"
                >
                  <ExternalLink className="h-4 w-4" />
                  Track on courier site
                </a>
              )}

              <div className="mt-3">
                <ShipmentTrackingEvents
                  events={subOrder.tracking_events || []}
                  title="Updates"
                  emptyMessage="Tracking updates will appear once your shipment is in transit."
                  className="shadow-none"
                />
              </div>
            </div>
          );
        })}
      </div>

      {order.return_shipments && order.return_shipments.length > 0 && (
        <div className="mx-4 mt-6 space-y-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Return shipments</p>
          {order.return_shipments.map((shipment) => {
            const trackingUrl = getReturnTrackingUrl(shipment);
            return (
              <div key={shipment.id} className="rounded-2xl bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
                      <Package className="h-4 w-4 text-primary-600" />
                      {shipment.method === 'pickup' ? 'Fez pickup' : 'Drop-off'}
                    </p>
                    <p className="mt-1 font-mono text-xs text-gray-600">{shipment.return_code || '—'}</p>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${statusPillClass(shipment.status || 'pending')}`}>
                    {(shipment.status || 'pending').replace(/_/g, ' ')}
                  </span>
                </div>
                {trackingUrl && (
                  <a
                    href={trackingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary-600"
                  >
                    {shipment.fez_tracking}
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}

      <section className="mx-4 mt-6 rounded-2xl border border-blue-100 bg-blue-50 p-4">
        <p className="text-sm font-semibold text-blue-900">Need help?</p>
        <p className="mt-1 text-xs text-blue-800">Our support team is here for order questions.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a
            href="mailto:support@julinemart.com"
            className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-xs font-medium text-gray-700"
          >
            <Mail className="h-3.5 w-3.5" />
            Email
          </a>
          <a
            href="tel:+2347075825761"
            className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-xs font-medium text-gray-700"
          >
            <Phone className="h-3.5 w-3.5" />
            Call
          </a>
          <button
            type="button"
            onClick={() => navigate(homePath)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-xs font-medium text-gray-700"
          >
            <Home className="h-3.5 w-3.5" />
            Track another
          </button>
        </div>
      </section>
    </div>
  );
}
