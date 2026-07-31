import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Box,
  CheckCircle,
  Download,
  ExternalLink,
  Loader,
  Package,
  Printer,
  RefreshCw,
  Truck,
} from 'lucide-react';
import { useNotification } from '../../contexts/NotificationContext';
import { supabase } from '../../contexts/AuthContext';
import { buildSupabaseFunctionUrl } from '../../utils/supabaseFunctions';
import { openWaybillPrint } from '../../lib/waybillPrint';
import { ContactSection, DetailRow, SectionLabel } from '../components/MobileDetailParts';
import { Sheet } from '../Sheet';
import { TABBAR_SPACE } from '../lib/functionsAuth';
import { formatNaira } from '../lib/displayUtils';

type Identifier = string | number;

type Item = {
  sku?: string;
  name?: string;
  quantity?: number;
  weight?: number;
  price?: number;
  variationId?: string | number | null;
  variationAttributes?: Record<string, unknown> | Array<Record<string, unknown>>;
};

function formatVariation(item: Item): string | null {
  const v = item.variationAttributes as unknown;
  if (v == null) return null;
  const rows = Array.isArray(v) ? v : [v];
  const parts = rows
    .map((a: Record<string, unknown>) => {
      if (!a || typeof a !== 'object') return '';
      const name = String(a.name ?? a.attribute ?? '').trim();
      const val = a.option ?? a.value ?? a.option_value ?? '';
      const valStr = val != null ? String(val).trim() : '';
      if (name && valStr) return `${name}: ${valStr}`;
      return valStr || name;
    })
    .filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

type ShipmentLane = 'fez' | 'local_rider';
const DEFAULT_ELIGIBLE_LANES: ShipmentLane[] = ['fez', 'local_rider'];

type SubOrder = {
  id: Identifier;
  metadata?: Record<string, any> | null;
  tracking_number?: string;
  status: string;
  real_shipping_cost?: number;
  allocated_shipping_fee?: number;
  courier_shipment_id?: string;
  courier_waybill?: string;
  courier_tracking_url?: string;
  label_url?: string;
  waybill_url?: string;
  waybill_number?: string | null;
  last_tracking_update?: string;
  items?: Item[];
  hubs?: { name?: string; city?: string };
  couriers?: { id?: string; name?: string; code?: string; api_enabled?: boolean };
  delivery_person_name?: string | null;
  delivery_person_phone?: string | null;
  delivery_person_vehicle?: string | null;
};

type Order = {
  id: Identifier;
  order_number: number | null;
  woocommerce_order_id: string | null;
  payment_reference: string | null;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  delivery_address: string;
  delivery_city: string;
  delivery_state: string;
  total_amount: number;
  shipping_fee_paid: number;
  overall_status: string;
  created_at: string;
  sub_orders?: SubOrder[];
};

const STATUS_PRIORITY: Record<string, number> = {
  pending: 1, vendor_dispatched: 2, processing: 2, assigned: 3, picked_up: 4,
  in_transit: 5, out_for_delivery: 6, delivered: 7, returned: 8, failed: 9, cancelled: 10,
};

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  vendor_dispatched: 'bg-amber-100 text-amber-800',
  assigned: 'bg-blue-100 text-blue-800',
  picked_up: 'bg-blue-100 text-blue-800',
  processing: 'bg-blue-100 text-blue-800',
  in_transit: 'bg-purple-100 text-purple-800',
  out_for_delivery: 'bg-orange-100 text-orange-800',
  delivered: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  returned: 'bg-red-100 text-red-800',
  cancelled: 'bg-red-100 text-red-800',
};

const TRACKING_STEPS: Array<{ key: string; label: string }> = [
  { key: 'pending', label: 'Pending' },
  { key: 'vendor_dispatched', label: 'Sent to Hub' },
  { key: 'assigned', label: 'Assigned' },
  { key: 'picked_up', label: 'Picked Up' },
  { key: 'out_for_delivery', label: 'Out for Delivery' },
  { key: 'delivered', label: 'Delivered' },
];

function deriveOrderStatus(order: Order | null, subOrders: SubOrder[]) {
  const fallback = order?.overall_status || 'pending';
  let best = fallback;
  subOrders.forEach((sub) => {
    if ((STATUS_PRIORITY[sub.status] ?? 0) > (STATUS_PRIORITY[best] ?? 0)) best = sub.status;
  });
  return best;
}

function getEligibleLanes(subOrder: SubOrder): ShipmentLane[] {
  const lanes = subOrder?.metadata?.eligible_lanes;
  if (!Array.isArray(lanes) || lanes.length === 0) return DEFAULT_ELIGIBLE_LANES;
  const normalized = lanes
    .map((lane) => (typeof lane === 'string' ? lane.toLowerCase() : ''))
    .filter((lane): lane is ShipmentLane => lane === 'fez' || lane === 'local_rider');
  return normalized.length > 0 ? normalized : DEFAULT_ELIGIBLE_LANES;
}

function getSelectedLane(subOrder: SubOrder): ShipmentLane {
  return subOrder?.metadata?.selected_lane === 'local_rider' ? 'local_rider' : 'fez';
}

function isRealFezTrackingNumber(value?: string): boolean {
  if (!value || typeof value !== 'string') return false;
  const errorIndicators = ['error', 'cannot', 'failed', 'invalid', 'wrong', 'something went wrong', 'already exists'];
  const lower = value.toLowerCase();
  if (errorIndicators.some((i) => lower.includes(i))) return false;
  if (/^(FEZ|JLO|CR)(-\d+-[A-Z0-9]+|-[A-Z0-9]{6,10})$/i.test(value)) return false;
  return value.length > 5 && value.length < 30 && /^[A-Za-z0-9]+$/.test(value.trim());
}

function hasValidShipment(subOrder: SubOrder): boolean {
  return isRealFezTrackingNumber(subOrder.tracking_number || subOrder.courier_waybill);
}

function hasShipmentError(subOrder: SubOrder): boolean {
  const tracking = (subOrder.tracking_number || subOrder.courier_waybill || '').toLowerCase();
  return tracking.includes('error') || tracking.includes('cannot') || tracking.includes('something went wrong');
}

// Same fetchOrderDetails/createCourierShipment/assignLocalRider/updateLocalDeliveryStatus/
// fetchLiveTracking/printLabel logic as OrderDetails.tsx (desktop) — this covers every
// action the desktop page has, laid out for a phone: a dispatch-method sheet instead of
// a dropdown, a rider-assignment sheet instead of a modal, and a horizontally-scrolling
// tracking stepper instead of a fixed-width one.
export default function MobileOrderDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const notification = useNotification();
  const functionsBase = import.meta.env.VITE_NETLIFY_FUNCTIONS_BASE || '/.netlify/functions';

  const [order, setOrder] = useState<Order | null>(null);
  const [subOrders, setSubOrders] = useState<SubOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchingTracking, setFetchingTracking] = useState<Identifier | null>(null);
  const [statusUpdating, setStatusUpdating] = useState<Identifier | null>(null);
  const [dispatchTarget, setDispatchTarget] = useState<SubOrder | null>(null);
  const [riderTarget, setRiderTarget] = useState<Identifier | null>(null);
  const [riderInfo, setRiderInfo] = useState({ name: '', phone: '', vehicle: '' });

  const derivedStatus = useMemo(() => deriveOrderStatus(order, subOrders), [order, subOrders]);

  const getAuthHeaders = async (): Promise<Record<string, string>> => {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
  };

  const fetchOrderDetails = async () => {
    try {
      const headers = await getAuthHeaders();
      const url = buildSupabaseFunctionUrl(`orders/${id}`);
      const response = await fetch(url, { headers: { 'Content-Type': 'application/json', ...headers } });
      const data = await response.json();
      if (data.success) {
        setOrder(data.data);
        setSubOrders(data.data.sub_orders || []);
      }
    } catch {
      notification.error('Failed to Load', 'Unable to fetch order details');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrderDetails();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const updateShipmentLane = async (subOrder: SubOrder, lane: ShipmentLane): Promise<boolean> => {
    const existing = subOrder.metadata && typeof subOrder.metadata === 'object' && !Array.isArray(subOrder.metadata) ? subOrder.metadata : {};
    const metadata = { ...existing, selected_lane: lane, eligible_lanes: getEligibleLanes(subOrder) };
    const { error } = await supabase.from('sub_orders').update({ metadata }).eq('id', String(subOrder.id));
    if (error) {
      notification.error('Lane Update Failed', error.message || 'Unable to update shipment lane');
      return false;
    }
    setSubOrders((prev) => prev.map((row) => (String(row.id) === String(subOrder.id) ? { ...row, metadata } : row)));
    return true;
  };

  const createCourierShipment = async (subOrder: SubOrder, options?: { force?: boolean }) => {
    try {
      const laneUpdated = await updateShipmentLane(subOrder, 'fez');
      if (!laneUpdated) return;
      const authHeaders = await getAuthHeaders();
      const response = await fetch(`${functionsBase}/fez-create-shipment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ subOrderId: subOrder.id, force: Boolean(options?.force) }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || data.message || 'Failed to create shipment');
      notification.success('Shipment Created!', `Tracking: ${data.data.tracking_number}`);
      await new Promise((r) => setTimeout(r, 500));
      await fetchOrderDetails();
    } catch (err) {
      notification.error('Creation Failed', err instanceof Error ? err.message : 'Failed to create shipment on courier platform');
      await fetchOrderDetails();
    }
  };

  const assignLocalRider = async () => {
    if (!riderTarget) return;
    try {
      const authHeaders = await getAuthHeaders();
      const response = await fetch(`${functionsBase}/assign-rider`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ sub_order_id: riderTarget, rider_name: riderInfo.name.trim(), rider_phone: riderInfo.phone.trim(), rider_vehicle: riderInfo.vehicle || null }),
      });
      const data = await response.json();
      if (!response.ok || !data?.success) throw new Error(data?.error || data?.message || 'Failed to assign local rider');
      notification.success('Rider assigned', 'Local rider saved for this shipment');
      setRiderTarget(null);
      setRiderInfo({ name: '', phone: '', vehicle: '' });
      await fetchOrderDetails();
    } catch (err) {
      notification.error('Assignment failed', err instanceof Error ? err.message : 'Unable to assign local rider');
    }
  };

  const updateLocalDeliveryStatus = async (subOrderId: Identifier, targetStatus: 'picked_up' | 'out_for_delivery' | 'delivered') => {
    setStatusUpdating(subOrderId);
    try {
      const authHeaders = await getAuthHeaders();
      const response = await fetch(`${functionsBase}/local-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ sub_order_id: subOrderId, status: targetStatus }),
      });
      const data = await response.json();
      if (!response.ok || !data?.success) throw new Error(data?.error || data?.message || 'Failed to update status');
      notification.success('Status updated', `Marked ${targetStatus.replace('_', ' ')}`);
      await fetchOrderDetails();
    } catch (err) {
      notification.error('Update failed', err instanceof Error ? err.message : 'Unable to update status');
    } finally {
      setStatusUpdating(null);
    }
  };

  const fetchLiveTracking = async (subOrderId: Identifier) => {
    setFetchingTracking(subOrderId);
    try {
      const response = await fetch(`${functionsBase}/fez-fetch-tracking?subOrderId=${encodeURIComponent(String(subOrderId))}`);
      const data = await response.json();
      if (data.success) {
        notification.success('Tracking Updated', `Status: ${data.data.fez_status || data.data.status || 'Updated'}`);
        await fetchOrderDetails();
      } else {
        notification.error('Tracking Failed', data.error || 'Unable to fetch tracking');
      }
    } catch {
      notification.error('Error', 'Failed to fetch live tracking');
    } finally {
      setFetchingTracking(null);
    }
  };

  const printLabel = (subOrderId: Identifier) => {
    window.open(`${functionsBase}/generate-label?subOrderId=${subOrderId}&print=true`, '_blank');
  };

  const printWaybill = async (subOrderId: Identifier) => {
    try {
      await openWaybillPrint({ subOrderId: String(subOrderId) });
    } catch (err) {
      notification.error('Waybill failed', err instanceof Error ? err.message : 'Could not open waybill');
    }
  };

  const downloadLabel = (url?: string) => {
    if (url) window.open(url, '_blank');
  };

  const getDisplayTracking = (subOrder: SubOrder) => {
    const tracking = subOrder.tracking_number || subOrder.courier_waybill;
    return isRealFezTrackingNumber(tracking) ? tracking : null;
  };

  if (loading) {
    return (
      <div className="flex min-h-[240px] items-center justify-center">
        <Loader className="h-6 w-6 animate-spin text-primary-600" />
      </div>
    );
  }

  if (!order) {
    return <div className="p-4 text-sm text-gray-500">Order not found.</div>;
  }

  const orderLabel =
    order.order_number != null
      ? `#${order.order_number}`
      : order.woocommerce_order_id
        ? `#${order.woocommerce_order_id}`
        : order.payment_reference
          ? order.payment_reference
          : `#${String(order.id).slice(0, 8).toUpperCase()}`;

  return (
    <div className="flex min-h-full flex-col bg-gray-50">
      <div className="sticky top-0 z-10 flex shrink-0 items-center gap-2.5 border-b border-gray-100 bg-white px-3 py-2.5">
        <button type="button" onClick={() => navigate('/admin/orders')} className="shrink-0 text-gray-500">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-gray-900">{orderLabel}</span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${STATUS_STYLES[derivedStatus] || 'bg-gray-100 text-gray-800'}`}>
              {derivedStatus.replace(/_/g, ' ')}
            </span>
          </div>
          <p className="truncate text-[11px] text-gray-400">
            Placed {new Date(order.created_at).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}
          </p>
        </div>
      </div>

      <div className="flex-1 pb-4" style={{ paddingBottom: TABBAR_SPACE }}>
        <div className="border-b border-gray-100 bg-white px-4 py-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Deliver to</p>
          <p className="mt-0.5 text-xl font-bold text-gray-900">{order.customer_name}</p>
          <p className="mt-1 text-sm text-gray-600">{order.delivery_address}</p>
          <p className="text-sm text-gray-500">
            {order.delivery_city}, {order.delivery_state}
          </p>
        </div>

        <ContactSection
          title="Customer"
          name={order.customer_name}
          lines={[order.customer_email].filter(Boolean) as string[]}
          phone={order.customer_phone}
        />

        <SectionLabel>Order summary</SectionLabel>
        <div className="mx-4 divide-y divide-gray-100 overflow-hidden rounded-xl bg-white">
          <DetailRow label="Subtotal" value={formatNaira((order.total_amount ?? 0) - (order.shipping_fee_paid ?? 0))} mono />
          <DetailRow label="Shipping" value={formatNaira(order.shipping_fee_paid ?? 0)} mono />
          <div className="flex items-center justify-between gap-3 px-4 py-3.5">
            <span className="text-sm font-medium text-gray-900">Total</span>
            <span className="text-sm font-bold tabular-nums text-primary-600">{formatNaira(order.total_amount ?? 0)}</span>
          </div>
        </div>

        <SectionLabel>Shipments ({subOrders.length})</SectionLabel>
        <div className="mx-4 space-y-3">
      {subOrders.map((subOrder) => {
        const validShipment = hasValidShipment(subOrder);
        const shipmentError = hasShipmentError(subOrder);
        const displayTracking = getDisplayTracking(subOrder);
        const selectedLane = getSelectedLane(subOrder);
        const isLocalRider = subOrder.couriers?.code?.toLowerCase() === 'local-rider';
        const isCourierApi = subOrder.couriers?.api_enabled || subOrder.couriers?.code?.toLowerCase() === 'fez';
        const canMarkPickedUp = isLocalRider && !['picked_up', 'out_for_delivery', 'delivered'].includes(subOrder.status);
        const canMarkOutForDelivery = isLocalRider && !['out_for_delivery', 'delivered'].includes(subOrder.status);
        const canMarkDelivered = isLocalRider && subOrder.status !== 'delivered';
        const items = subOrder.items ?? [];
        const itemsSubtotal = items.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0);
        const allocatedShippingFee = Number(subOrder.allocated_shipping_fee || 0);
        const currentStepIndex = TRACKING_STEPS.findIndex((s) => s.key === subOrder.status);

        return (
          <div key={subOrder.id} className="space-y-3 overflow-hidden rounded-xl bg-white p-3.5 shadow-sm ring-1 ring-gray-100">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
                  <Truck className="h-4 w-4 shrink-0 text-primary-600" />
                  <span className="truncate">{subOrder.hubs?.name || 'Unknown Hub'} · {subOrder.couriers?.name || 'Courier'}</span>
                </div>
                <p className="mt-0.5 text-xs text-gray-500">{subOrder.hubs?.city} · Customer share {formatNaira(allocatedShippingFee)}</p>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold uppercase ${STATUS_STYLES[subOrder.status] || 'bg-gray-100 text-gray-800'}`}>
                {subOrder.status}
              </span>
            </div>

            {items.length > 0 && (
              <div className="rounded-lg border border-green-200 bg-green-50 p-3">
                <div className="mb-2 flex items-center gap-1.5">
                  <Box className="h-4 w-4 text-green-600" />
                  <span className="text-xs font-semibold text-green-900">Items to pack</span>
                </div>
                <div className="space-y-2">
                  {items.map((item, idx) => {
                    const variation = formatVariation(item);
                    return (
                      <div key={idx} className="rounded-md border border-green-100 bg-white p-2.5">
                        <p className="text-sm font-medium text-gray-900">
                          <span className="mr-1.5 rounded bg-green-600 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white">{item.quantity ?? 0}×</span>
                          {item.name}
                        </p>
                        <div className="mt-1 space-y-0.5 text-[11px] text-gray-500">
                          {variation && <p className="font-medium text-purple-700">{variation}</p>}
                          {item.sku && <p>SKU: {item.sku}</p>}
                          {item.weight != null && <p>{item.weight}kg / unit</p>}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-2 space-y-1 border-t border-green-200 pt-2 text-xs">
                  <div className="flex justify-between text-green-900">
                    <span>Items subtotal</span>
                    <span className="font-mono font-semibold">{formatNaira(itemsSubtotal)}</span>
                  </div>
                  <div className="flex justify-between font-semibold text-green-900">
                    <span>Sub-order total</span>
                    <span className="font-mono">{formatNaira(itemsSubtotal + allocatedShippingFee)}</span>
                  </div>
                </div>
              </div>
            )}

            {isCourierApi && (
              <div className="space-y-3 rounded-lg border border-blue-200 bg-blue-50 p-3">
                <div>
                  <label className="mb-1 block font-mono text-[10px] uppercase tracking-wide text-blue-900">Shipment lane</label>
                  <select
                    value={selectedLane}
                    onChange={(event) => updateShipmentLane(subOrder, event.target.value === 'local_rider' ? 'local_rider' : 'fez')}
                    className="w-full rounded-md border border-blue-200 bg-white px-2 py-2 text-sm"
                    style={{ fontSize: '16px' }}
                  >
                    {getEligibleLanes(subOrder).map((lane) => (
                      <option key={lane} value={lane}>{lane === 'fez' ? 'Fez' : 'Local Rider'}</option>
                    ))}
                  </select>
                </div>

                {shipmentError && (
                  <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-2.5">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                    <div>
                      <p className="text-xs font-medium text-red-800">Previous shipment creation failed</p>
                      <p className="mt-0.5 text-[11px] text-red-600">{subOrder.tracking_number || subOrder.courier_waybill}</p>
                    </div>
                  </div>
                )}

                {displayTracking && (
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-gray-500">Tracking</span>
                      <p className="font-mono font-medium text-gray-900">{displayTracking}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Shipment ID</span>
                      <p className="truncate font-mono text-[11px] text-gray-900">{subOrder.courier_shipment_id || 'Not yet created'}</p>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  {!subOrder.delivery_person_name && (
                    <button
                      type="button"
                      onClick={() => setDispatchTarget(subOrder)}
                      className="rounded-lg bg-primary-600 px-3 py-2.5 text-xs font-semibold text-white"
                    >
                      Dispatch order
                    </button>
                  )}
                  {displayTracking && (
                    <a
                      href={`https://web.fezdelivery.co/track-delivery?tracking=${displayTracking}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2.5 text-xs font-semibold text-gray-900"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Track on Fez
                    </a>
                  )}
                  {displayTracking && (
                    <button
                      type="button"
                      onClick={() => fetchLiveTracking(subOrder.id)}
                      disabled={fetchingTracking === subOrder.id}
                      className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2.5 text-xs font-semibold text-gray-900 disabled:opacity-60"
                    >
                      {fetchingTracking === subOrder.id ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                      Update tracking
                    </button>
                  )}
                  <button type="button" onClick={() => printLabel(subOrder.id)} className="flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-2.5 text-xs font-semibold text-white">
                    <Printer className="h-3.5 w-3.5" />
                    Print label
                  </button>
                  {subOrder.label_url && (
                    <button type="button" onClick={() => downloadLabel(subOrder.label_url)} className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2.5 text-xs font-semibold text-gray-900">
                      <Download className="h-3.5 w-3.5" />
                      Label
                    </button>
                  )}
                  {(subOrder.tracking_number || subOrder.delivery_person_name) && (
                    <button type="button" onClick={() => printWaybill(subOrder.id)} className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2.5 text-xs font-semibold text-gray-900">
                      <Download className="h-3.5 w-3.5" />
                      Waybill
                    </button>
                  )}
                </div>

                {(subOrder.tracking_number || subOrder.delivery_person_name) && (
                  <div className="rounded-lg border border-green-200 bg-green-50 p-2.5 text-xs">
                    {subOrder.tracking_number && <p><span className="font-semibold">JLO Tracking:</span> {subOrder.tracking_number}</p>}
                    {subOrder.waybill_number && (
                      <p className="mt-0.5"><span className="font-semibold">Waybill No:</span> {subOrder.waybill_number}</p>
                    )}
                    {subOrder.delivery_person_name && (
                      <p className="mt-0.5"><span className="font-semibold">Local Rider:</span> {subOrder.delivery_person_name} {subOrder.delivery_person_phone && `(${subOrder.delivery_person_phone})`}</p>
                    )}
                  </div>
                )}

                {subOrder.last_tracking_update && (
                  <p className="text-[11px] text-gray-500">Last updated: {new Date(subOrder.last_tracking_update).toLocaleString()}</p>
                )}

                <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pt-1">
                  {TRACKING_STEPS.map((step, i) => (
                    <div key={step.key} className="flex shrink-0 flex-col items-center gap-1" style={{ width: 64 }}>
                      <div className={`h-2 w-2 rounded-full ${i <= currentStepIndex ? 'bg-primary-600' : 'bg-gray-200'}`} />
                      <span className={`text-center text-[9px] leading-tight ${i <= currentStepIndex ? 'font-semibold text-gray-900' : 'text-gray-400'}`}>{step.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {isLocalRider && (
              <div className="space-y-2 rounded-lg border border-yellow-200 bg-yellow-50 p-3">
                <p className="text-xs font-semibold text-yellow-900">Manual local delivery status</p>
                <div className="flex flex-wrap gap-2">
                  {canMarkPickedUp && (
                    <button type="button" onClick={() => updateLocalDeliveryStatus(subOrder.id, 'picked_up')} disabled={statusUpdating === subOrder.id} className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-xs font-semibold text-gray-900 disabled:opacity-60">
                      {statusUpdating === subOrder.id ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <Package className="h-3.5 w-3.5" />}
                      Picked up
                    </button>
                  )}
                  {canMarkOutForDelivery && (
                    <button type="button" onClick={() => updateLocalDeliveryStatus(subOrder.id, 'out_for_delivery')} disabled={statusUpdating === subOrder.id} className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-xs font-semibold text-gray-900 disabled:opacity-60">
                      {statusUpdating === subOrder.id ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <Truck className="h-3.5 w-3.5" />}
                      Out for delivery
                    </button>
                  )}
                  {canMarkDelivered && (
                    <button type="button" onClick={() => updateLocalDeliveryStatus(subOrder.id, 'delivered')} disabled={statusUpdating === subOrder.id} className="flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-2.5 text-xs font-semibold text-white disabled:opacity-60">
                      {statusUpdating === subOrder.id ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />}
                      Delivered
                    </button>
                  )}
                </div>
              </div>
            )}

            {!isCourierApi && (
              <div className="rounded-lg bg-gray-50 p-3">
                <p className="text-xs text-gray-500">Manual tracking number</p>
                <p className="font-mono text-sm font-semibold text-gray-900">{subOrder.tracking_number || 'Not assigned'}</p>
                <button
                  type="button"
                  onClick={() => printLabel(subOrder.id)}
                  disabled={!subOrder.tracking_number}
                  className="mt-2 flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-xs font-semibold text-gray-900 disabled:opacity-60"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Print label
                </button>
              </div>
            )}
          </div>
        );
      })}
        </div>
      </div>

      <Sheet open={!!dispatchTarget} onClose={() => setDispatchTarget(null)} ariaLabel="Dispatch order">
        {dispatchTarget && (
          <div className="space-y-2">
            <h3 className="text-base font-bold text-gray-900">Dispatch order</h3>
            <button
              type="button"
              disabled={!getEligibleLanes(dispatchTarget).includes('fez') || getSelectedLane(dispatchTarget) === 'local_rider'}
              onClick={async () => {
                const target = dispatchTarget;
                setDispatchTarget(null);
                if (!target) return;
                if (hasValidShipment(target) && !window.confirm('This will create a new Fez shipment and replace the current tracking. Continue?')) return;
                await createCourierShipment(target, { force: hasValidShipment(target) });
              }}
              className="w-full rounded-lg border border-gray-200 p-3 text-left disabled:opacity-40"
            >
              <div className="text-sm font-semibold text-gray-900">Send to Fez</div>
              <div className="text-xs text-gray-500">API courier with tracking</div>
            </button>
            <button
              type="button"
              disabled={!getEligibleLanes(dispatchTarget).includes('local_rider') || getSelectedLane(dispatchTarget) === 'fez'}
              onClick={async () => {
                const target = dispatchTarget;
                setDispatchTarget(null);
                if (!target) return;
                const ok = await updateShipmentLane(target, 'local_rider');
                if (!ok) return;
                setRiderInfo({ name: '', phone: '', vehicle: '' });
                setRiderTarget(target.id);
              }}
              className="w-full rounded-lg border border-gray-200 p-3 text-left disabled:opacity-40"
            >
              <div className="text-sm font-semibold text-gray-900">Assign local rider</div>
              <div className="text-xs text-gray-500">Manual delivery (same state)</div>
            </button>
          </div>
        )}
      </Sheet>

      <Sheet open={!!riderTarget} onClose={() => setRiderTarget(null)} ariaLabel="Assign local rider">
        <h3 className="text-base font-bold text-gray-900">Assign local rider</h3>
        <div className="space-y-3">
          <input type="text" placeholder="Rider name" value={riderInfo.name} onChange={(e) => setRiderInfo((p) => ({ ...p, name: e.target.value }))} className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm" style={{ fontSize: '16px' }} />
          <input type="tel" placeholder="Rider phone" value={riderInfo.phone} onChange={(e) => setRiderInfo((p) => ({ ...p, phone: e.target.value }))} className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm" style={{ fontSize: '16px' }} />
          <input type="text" placeholder="Vehicle (optional)" value={riderInfo.vehicle} onChange={(e) => setRiderInfo((p) => ({ ...p, vehicle: e.target.value }))} className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm" style={{ fontSize: '16px' }} />
        </div>
        <button
          type="button"
          onClick={assignLocalRider}
          disabled={!riderInfo.name || !riderInfo.phone}
          className="rounded-lg bg-primary-600 py-3 text-sm font-semibold text-white disabled:opacity-60"
        >
          Save rider
        </button>
      </Sheet>
    </div>
  );
}
