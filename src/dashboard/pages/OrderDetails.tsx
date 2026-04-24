import { useEffect, useMemo, useState, ChangeEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  MapPin,
  User,
  Truck,
  Download,
  ExternalLink,
  Loader,
  CheckCircle,
  Box,
  AlertTriangle,
  RefreshCw,
  Printer,
  Package,
} from 'lucide-react';
import { useNotification } from '../contexts/NotificationContext';
import { supabase } from '../contexts/AuthContext';
import { buildSupabaseFunctionUrl } from '../utils/supabaseFunctions';

type Identifier = string | number;
type KnownStatus =
  | 'pending'
  | 'assigned'
  | 'picked_up'
  | 'in_transit'
  | 'out_for_delivery'
  | 'delivered'
  | 'failed'
  | 'returned'
  | 'cancelled'
  | 'processing';

type Item = {
  sku?: string;
  name?: string;
  quantity?: number;
  weight?: number;
  price?: number;
  variationId?: string | number | null;
  /** From sub_orders.items — array (Woo/Supabase) or legacy object */
  variationAttributes?: Record<string, unknown> | Array<Record<string, unknown>>;
};

function formatVariationForOrderItem(item: Item): string | null {
  const v = item.variationAttributes as unknown;
  if (v == null) return null;
  if (Array.isArray(v)) {
    const parts = v
      .map((a: Record<string, unknown>) => {
        if (!a || typeof a !== 'object') return '';
        const name = String(a.name ?? a.attribute ?? '').trim();
        const val = a.option ?? a.value ?? a.option_value ?? '';
        const valStr = val !== undefined && val !== null ? String(val).trim() : '';
        if (name && valStr) return `${name}: ${valStr}`;
        if (valStr) return valStr;
        return name;
      })
      .filter(Boolean);
    return parts.length ? parts.join(', ') : null;
  }
  if (typeof v === 'object') {
    const parts = Object.entries(v as Record<string, unknown>)
      .map(([k, val]) =>
        val != null && String(val) !== '' ? `${k}: ${String(val)}` : ''
      )
      .filter(Boolean);
    return parts.length ? parts.join(', ') : null;
  }
  return null;
}

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
  last_tracking_update?: string;
  items?: Item[];
  hubs?: {
    name?: string;
    city?: string;
  };
  couriers?: {
    id?: string;
    name?: string;
    code?: string;
    api_enabled?: boolean;
  };
  delivery_person_name?: string | null;
  delivery_person_phone?: string | null;
  delivery_person_vehicle?: string | null;
};

type ReturnShipment = {
  id: string;
  return_request_id?: string;
  // NEW: support both new tracking_number and old fez_tracking
  tracking_number?: string | null;
  fez_tracking?: string | null;
  method: 'pickup' | 'dropoff';
  return_code?: string;
  status?:
    | 'awaiting_tracking'
    | 'in_transit'
    | 'delivered_to_hub'
    | 'inspection_in_progress'
    | 'approved'
    | 'refund_processing'
    | 'refund_completed'
    | 'rejected'
    | 'pickup_scheduled'
    | 'awaiting_dropoff'
    | 'pending'
    | 'delivered'
    | 'completed';
  created_at?: string;
  customer_submitted_tracking?: boolean;
  tracking_submitted_at?: string;
  return_request?: {
    id?: string;
    customer_name?: string;
    customer_email?: string;
    preferred_resolution?: string;
    reason_code?: string;
    reason_note?: string;
    images?: string[];
    status?: string;
  };
};

type ShipmentLane = 'fez' | 'local_rider';
const DEFAULT_ELIGIBLE_LANES: ShipmentLane[] = ['fez', 'local_rider'];

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
  pending: 1,
  processing: 2,
  assigned: 3,
  picked_up: 4,
  in_transit: 5,
  out_for_delivery: 6,
  delivered: 7,
  returned: 8,
  failed: 9,
  cancelled: 10,
};

const getStatusPriority = (status?: string) => {
  if (!status) return 0;
  return STATUS_PRIORITY[status] ?? 0;
};

const deriveOrderStatus = (order: Order | null, subOrders: SubOrder[]) => {
  const fallback = order?.overall_status || 'pending';
  let bestStatus = fallback;
  subOrders.forEach((sub) => {
    if (getStatusPriority(sub.status) > getStatusPriority(bestStatus)) {
      bestStatus = sub.status;
    }
  });
  return bestStatus;
};

const getEligibleLanes = (subOrder: SubOrder): ShipmentLane[] => {
  const lanes = subOrder?.metadata?.eligible_lanes;
  if (!Array.isArray(lanes) || lanes.length === 0) {
    return DEFAULT_ELIGIBLE_LANES;
  }

  const normalized = lanes
    .map((lane) => (typeof lane === 'string' ? lane.toLowerCase() : ''))
    .filter((lane): lane is ShipmentLane => lane === 'fez' || lane === 'local_rider');

  return normalized.length > 0 ? normalized : DEFAULT_ELIGIBLE_LANES;
};

const getSelectedLane = (subOrder: SubOrder): ShipmentLane => {
  const lane = subOrder?.metadata?.selected_lane;
  return lane === 'local_rider' ? 'local_rider' : 'fez';
};

/**
 * Tracking Timeline Component - Shows horizontal progress stepper
 */
const TrackingTimeline = ({ status }: { status: string }) => {
  const steps = [
    { key: 'pending', label: 'Pending' },
    { key: 'assigned', label: 'Assigned' },
    { key: 'picked_up', label: 'Picked Up' },
    { key: 'in_transit', label: 'In Transit' },
    { key: 'out_for_delivery', label: 'Out for Delivery' },
    { key: 'delivered', label: 'Delivered' },
  ];

  // Map various status names to our step keys
  const normalizeStatus = (s: string): string => {
    const statusMap: Record<string, string> = {
      pending: 'pending',
      pending_pickup: 'assigned',
      assigned: 'assigned',
      picked_up: 'picked_up',
      in_transit: 'in_transit',
      dispatched: 'in_transit',
      out_for_delivery: 'out_for_delivery',
      delivered: 'delivered',
      processing: 'pending',
      cancelled: 'cancelled',
      returned: 'returned',
      failed: 'failed',
    };
    return statusMap[s.toLowerCase()] || 'pending';
  };

  const currentStatus = normalizeStatus(status);
  const currentIndex = steps.findIndex((step) => step.key === currentStatus);

  // Handle cancelled/returned/failed states
  if (['cancelled', 'returned', 'failed'].includes(currentStatus)) {
    return (
      <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
        <div className="flex items-center gap-2 text-red-700">
          <AlertTriangle className="w-4 h-4" />
          <span className="font-medium capitalize">{status.replace('_', ' ')}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 pt-4 border-t border-blue-200">
      <p className="text-xs text-blue-700 mb-3 font-medium">Tracking Progress</p>
      <div className="flex items-center justify-between">
        {steps.map((step, index) => {
          const isCompleted = index <= currentIndex;
          const isCurrent = index === currentIndex;

          return (
            <div key={step.key} className="flex items-center flex-1">
              {/* Step Circle */}
              <div className="flex flex-col items-center">
                <div
                  className={`
                    w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold
                    transition-all duration-300
                    ${
                      isCompleted
                        ? 'bg-green-500 text-white'
                        : 'bg-gray-200 text-gray-400'
                    }
                    ${isCurrent ? 'ring-2 ring-green-300 ring-offset-1' : ''}
                  `}
                >
                  {isCompleted ? '✓' : index + 1}
                </div>
                <span
                  className={`
                    text-[10px] mt-1 text-center leading-tight max-w-[60px]
                    ${isCompleted ? 'text-green-600 font-medium' : 'text-gray-400'}
                    ${isCurrent ? 'font-semibold' : ''}
                  `}
                >
                  {step.label}
                </span>
              </div>

              {/* Connector Line */}
              {index < steps.length - 1 && (
                <div
                  className={`
                    flex-1 h-0.5 mx-1
                    ${index < currentIndex ? 'bg-green-500' : 'bg-gray-200'}
                  `}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

/**
 * Check if a tracking number is a REAL Fez tracking number (not auto-generated)
 */
function isRealFezTrackingNumber(value?: string): boolean {
  if (!value || typeof value !== 'string') return false;

  // Reject error messages
  const errorIndicators = [
    'error',
    'cannot',
    'failed',
    'invalid',
    'wrong',
    'something went wrong',
    'already exists',
  ];

  const lowerValue = value.toLowerCase();
  for (const indicator of errorIndicators) {
    if (lowerValue.includes(indicator)) {
      return false;
    }
  }

  // Reject auto-generated tracking numbers (these are NOT from Fez)
  // Format: JLO-XXXXXXXX (10–13 chars) or legacy FEZ/CR-timestamp-random
  if (/^(FEZ|JLO|CR)(-\d+-[A-Z0-9]+|-[A-Z0-9]{6,10})$/i.test(value)) {
    return false;
  }

  // Valid Fez tracking numbers are typically like: GWD026112514, 3N4827112532
  // They should be alphanumeric, reasonably short, and NOT contain dashes with timestamp patterns
  return value.length > 5 && value.length < 30 && /^[A-Za-z0-9]+$/.test(value.trim());
}

/**
 * Check if a suborder has a valid courier shipment (real Fez tracking, not auto-generated)
 */
function hasValidShipment(subOrder: SubOrder): boolean {
  const tracking = subOrder.tracking_number || subOrder.courier_waybill;
  return isRealFezTrackingNumber(tracking);
}

/**
 * Check if a suborder has an error from a previous shipment attempt
 */
function hasShipmentError(subOrder: SubOrder): boolean {
  const tracking = subOrder.tracking_number || subOrder.courier_waybill || '';
  return (
    tracking.toLowerCase().includes('error') ||
    tracking.toLowerCase().includes('cannot') ||
    tracking.toLowerCase().includes('something went wrong')
  );
}

export function OrderDetailsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const notification = useNotification();

  // FIXED: Added functionsBase for Netlify functions
  const functionsBase = import.meta.env.VITE_NETLIFY_FUNCTIONS_BASE || '/.netlify/functions';
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
  
  const [order, setOrder] = useState<Order | null>(null);
  const [subOrders, setSubOrders] = useState<SubOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchingTracking, setFetchingTracking] = useState<Identifier | null>(null);
  const [returnShipments, setReturnShipments] = useState<ReturnShipment[]>([]);
  const [trackingFilter, setTrackingFilter] = useState<'all' | 'with' | 'without'>('all');
  const [showDispatchMenu, setShowDispatchMenu] = useState<Identifier | null>(null);
  const [showRiderModal, setShowRiderModal] = useState<Identifier | null>(null);
  const [riderInfo, setRiderInfo] = useState({ name: '', phone: '', vehicle: '' });
  const [statusUpdating, setStatusUpdating] = useState<Identifier | null>(null);
  const derivedStatus = useMemo(
    () => deriveOrderStatus(order, subOrders),
    [order, subOrders]
  );

  const formatCurrency = (value?: number | null) => {
    const amount = typeof value === 'number' ? value : 0;
    return amount.toLocaleString();
  };

  const getAuthHeaders = async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const headers: HeadersInit = {};
    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`;
    }
    return headers;
  };

  const fetchOrderDetails = async () => {
    try {
      console.log('Fetching order details for:', id);
      const headers = await getAuthHeaders();
      const url = buildSupabaseFunctionUrl(`orders/${id}`);
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
      });
      const data = await response.json();

      console.log('Order details response:', data);

      if (data.success) {
        setOrder(data.data);

        // Log sub_orders to debug
        if (data.data.sub_orders) {
          data.data.sub_orders.forEach((so: SubOrder) => {
            console.log(`SubOrder ${so.id}:`, {
              tracking_number: so.tracking_number,
              courier_shipment_id: so.courier_shipment_id,
              courier_tracking_url: so.courier_tracking_url,
              status: so.status,
              isRealFezTracking: isRealFezTrackingNumber(so.tracking_number),
            });
          });
        }

        setSubOrders(data.data.sub_orders || []);
      }
    } catch (error) {
      console.error('Error fetching order:', error);
      notification.error('Failed to Load', 'Unable to fetch order details');
    } finally {
      setLoading(false);
    }
  };

  const fetchReturnShipments = async () => {
    // Use the Supabase order UUID directly — no WooCommerce lookup needed
    const orderId = order?.id;
    if (!orderId) return;
    try {
      const headers = await getAuthHeaders();
      if (!supabaseAnonKey) {
        throw new Error('Missing Supabase anon key for return shipments');
      }

      const url = buildSupabaseFunctionUrl(
        `get-order-returns?order_id=${encodeURIComponent(String(orderId))}`
      );
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${supabaseAnonKey}`,
          apikey: supabaseAnonKey,
          ...headers,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch return shipments');
      }

      const data = await response.json();
      setReturnShipments(data?.data ?? []);
    } catch (error) {
      console.error('Error fetching return shipments:', error);
    }
  };

  useEffect(() => {
    fetchOrderDetails();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Fetch returns once the order is loaded (keyed on Supabase UUID)
  useEffect(() => {
    if (order?.id) {
      fetchReturnShipments();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id]);

  // Poll tracking for in-transit returns
  useEffect(() => {
    const interval = setInterval(() => {
      returnShipments
        .map((r) => ({
          shipmentId: r.id,
          requestId: r.return_request_id ?? r.return_request?.id,
          status: r.status,
        }))
        .filter((r) => r.status === 'in_transit' && r.requestId)
        .forEach((r) => fetchReturnTracking(r.requestId as string, r.shipmentId));
    }, 2 * 60 * 1000);
    return () => clearInterval(interval);
    // fetchReturnTracking is intentionally stable for polling; eslint dependency suppressed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returnShipments]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showDispatchMenu && !(event.target as Element).closest('.dispatch-dropdown')) {
        setShowDispatchMenu(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showDispatchMenu]);

  const updateShipmentLane = async (
    subOrder: SubOrder,
    lane: ShipmentLane
  ): Promise<boolean> => {
    const existingMetadata =
      subOrder.metadata &&
      typeof subOrder.metadata === 'object' &&
      !Array.isArray(subOrder.metadata)
        ? subOrder.metadata
        : {};
    const eligibleLanes = getEligibleLanes(subOrder);
    const metadata = {
      ...existingMetadata,
      selected_lane: lane,
      eligible_lanes: eligibleLanes,
    };

    const { error } = await supabase
      .from('sub_orders')
      .update({ metadata })
      .eq('id', String(subOrder.id));

    if (error) {
      console.error('Failed to update shipment lane:', error);
      notification.error(
        'Lane Update Failed',
        error.message || 'Unable to update shipment lane'
      );
      return false;
    }

    setSubOrders((prev) =>
      prev.map((row) =>
        String(row.id) === String(subOrder.id) ? { ...row, metadata } : row
      )
    );
    return true;
  };

  // FIXED: Changed from ${apiBase}/.netlify/functions/ to ${functionsBase}/
  const createCourierShipment = async (
    subOrder: SubOrder,
    options?: { force?: boolean }
  ) => {
    const subOrderId = subOrder.id;
    const force = Boolean(options?.force);

    try {
      const laneUpdated = await updateShipmentLane(subOrder, 'fez');
      if (!laneUpdated) return;

      const response = await fetch(`${functionsBase}/fez-create-shipment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subOrderId, force }),
      });

      const data = await response.json();

      console.log('Fez Create Shipment Response:', data);

      if (!response.ok || !data.success) {
        throw new Error(data.error || data.message || 'Failed to create shipment');
      }

      const trackingNumber = data.data.tracking_number;
      const shipmentId = data.data.courier_shipment_id;
      const trackingUrl = data.data.courier_tracking_url;

      notification.success('Shipment Created!', `Tracking: ${trackingNumber}`);

      // Instant UI update with the response data
      setSubOrders((prev) =>
        prev.map((so) =>
          so.id === subOrderId
            ? {
                ...so,
                tracking_number: trackingNumber,
                courier_shipment_id: shipmentId,
                courier_tracking_url: trackingUrl,
                courier_waybill: trackingNumber,
                status: 'assigned',
              }
            : so
        )
      );

      // Small delay to ensure database update is committed before refetching
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Refresh to get latest data from database
      await fetchOrderDetails();
    } catch (error) {
      console.error('Shipment Error', error);
      notification.error(
        'Creation Failed',
        error instanceof Error ? error.message : 'Failed to create shipment on courier platform'
      );

      // Refresh to show current state
      await fetchOrderDetails();
    }
  };

  const assignLocalRider = async (subOrderId: Identifier | null) => {
    if (!subOrderId) return;

    try {
      const token =
        typeof window !== 'undefined' ? localStorage.getItem('token') : null;
      const response = await fetch(`${functionsBase}/assign-rider`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          sub_order_id: subOrderId,
          rider_name: riderInfo.name.trim(),
          rider_phone: riderInfo.phone.trim(),
          rider_vehicle: riderInfo.vehicle || null,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data?.success) {
        throw new Error(data?.error || data?.message || 'Failed to assign local rider');
      }

      notification.success('Rider assigned', 'Local rider saved for this shipment');
      setShowRiderModal(null);
      setRiderInfo({ name: '', phone: '', vehicle: '' });
      await fetchOrderDetails();
    } catch (error) {
      console.error('Assign rider error', error);
      notification.error(
        'Assignment failed',
        error instanceof Error ? error.message : 'Unable to assign local rider'
      );
    }
  };

  const updateLocalDeliveryStatus = async (subOrderId: Identifier, targetStatus: 'out_for_delivery' | 'delivered') => {
    setStatusUpdating(subOrderId);
    try {
      const token =
        typeof window !== 'undefined' ? localStorage.getItem('token') : null;
      const response = await fetch(`${functionsBase}/local-status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          sub_order_id: subOrderId,
          status: targetStatus,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data?.success) {
        throw new Error(data?.error || data?.message || 'Failed to update status');
      }

      notification.success('Status updated', `Marked ${targetStatus.replace('_', ' ')}`);
      await fetchOrderDetails();
    } catch (error) {
      console.error('Local status update error', error);
      notification.error(
        'Update failed',
        error instanceof Error ? error.message : 'Unable to update status'
      );
    } finally {
      setStatusUpdating(null);
    }
  };

  // FIXED: Changed from ${apiBase}/api/ to ${functionsBase}/
  const fetchReturnTracking = async (returnRequestId: string, shipmentId: string) => {
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`${functionsBase}/returns/${returnRequestId}/tracking`, { headers });
      const data = await response.json();
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || 'Failed to fetch tracking');
      }
      if (data.data?.latest_status === 'delivered') {
        setReturnShipments((prev) =>
          prev.map((r) => (r.id === shipmentId ? { ...r, status: 'delivered_to_hub' } : r))
        );
      }
    } catch (error) {
      console.error('Return tracking error', error);
      notification.error(
        'Tracking failed',
        error instanceof Error ? error.message : 'Unable to fetch tracking'
      );
    }
  };

  // FIXED: Changed from ${apiBase}/.netlify/functions/ to ${functionsBase}/
  const fetchLiveTracking = async (subOrderId: Identifier) => {
    setFetchingTracking(subOrderId);

    try {
      const response = await fetch(
        `${functionsBase}/fez-fetch-tracking?subOrderId=${encodeURIComponent(
          String(subOrderId)
        )}`
      );
      const data = await response.json();

      if (data.success) {
        notification.success(
          'Tracking Updated',
          `Status: ${data.data.fez_status || data.data.status || 'Updated'}`
        );

        // Update local state immediately with the new status
        if (data.data.status) {
          setSubOrders((prev) =>
            prev.map((so) =>
              so.id === subOrderId
                ? {
                    ...so,
                    status: data.data.status,
                    last_tracking_update: data.data.last_update || new Date().toISOString(),
                  }
                : so
            )
          );
        }

        // Also refresh from database
        fetchOrderDetails();
      } else {
        notification.error('Tracking Failed', data.error || 'Unable to fetch tracking');
      }
    } catch (error) {
      console.error('Tracking error', error);
      notification.error('Error', 'Failed to fetch live tracking');
    } finally {
      setFetchingTracking(null);
    }
  };

  const downloadLabel = (labelUrl?: string) => {
    if (!labelUrl) return;
    window.open(labelUrl, '_blank');
  };

  const formatStatusText = (status?: string) => {
    if (!status) return 'pending';
    return status.replace(/_/g, ' ');
  };

  // FIXED: Changed from ${apiBase}/.netlify/functions/ to ${functionsBase}/
  const printLabel = (subOrderId: Identifier) => {
    // Open the generate-label function in a new window with print=true
    const labelUrl = `${functionsBase}/generate-label?subOrderId=${subOrderId}&print=true`;
    window.open(labelUrl, '_blank');
  };

  const getDisplayTracking = (subOrder: SubOrder) => {
    // Only return tracking if it's a REAL Fez tracking number
    const tracking = subOrder.tracking_number || subOrder.courier_waybill;
    if (isRealFezTrackingNumber(tracking)) {
      return tracking;
    }
    return null;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader className="w-8 h-8 animate-spin text-primary-600" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-600">Order not found</p>
      </div>
    );
  }

  const getStatusColor = (status: string) => {
    const colors: Record<KnownStatus, string> = {
      pending: 'bg-yellow-100 text-yellow-800',
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
    return colors[status as KnownStatus] || 'bg-gray-100 text-gray-800';
  };

  const getReturnStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      pickup_scheduled: 'bg-blue-100 text-blue-800',
      awaiting_dropoff: 'bg-yellow-100 text-yellow-800',
      pending: 'bg-yellow-100 text-yellow-800',
      awaiting_tracking: 'bg-gray-100 text-gray-800',
      in_transit: 'bg-blue-100 text-blue-800',
      delivered: 'bg-green-100 text-green-800',
      delivered_to_hub: 'bg-green-100 text-green-800',
      inspection_in_progress: 'bg-yellow-100 text-yellow-800',
      approved: 'bg-emerald-100 text-emerald-800',
      refund_processing: 'bg-orange-100 text-orange-800',
      refund_completed: 'bg-green-100 text-green-800',
      rejected: 'bg-red-100 text-red-800',
      completed: 'bg-emerald-100 text-emerald-800',
    };
    return colors[status] || 'bg-gray-100 text-gray-800';
  };

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <button
          onClick={() => navigate('/admin/orders')}
          className="flex items-center text-gray-600 hover:text-gray-900 mb-4"
        >
          <ArrowLeft className="w-5 h-5 mr-2" />
          Back to Orders
        </button>

        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">
              Order #{order.order_number ?? order.woocommerce_order_id ?? order.payment_reference ?? order.id.toString().slice(0, 8).toUpperCase()}
            </h1>
            <p className="text-gray-600 mt-2">
              Placed on {new Date(order.created_at).toLocaleDateString()}
            </p>
          </div>
          <span
            className={`px-4 py-2 rounded-full text-sm font-medium ${getStatusColor(
              derivedStatus
            )}`}
          >
            {derivedStatus}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Customer Info */}
        <div className="card">
          <h2 className="text-lg font-semibold mb-4 flex items-center">
            <User className="w-5 h-5 mr-2 text-primary-600" />
            Customer Information
          </h2>
          <div className="space-y-3 text-sm">
            <div>
              <span className="text-gray-600">Name:</span>
              <p className="font-medium">{order.customer_name}</p>
            </div>
            <div>
              <span className="text-gray-600">Email:</span>
              <p className="font-medium">{order.customer_email}</p>
            </div>
            <div>
              <span className="text-gray-600">Phone:</span>
              <p className="font-medium">{order.customer_phone}</p>
            </div>
          </div>
        </div>

        {/* Delivery Info */}
        <div className="card">
          <h2 className="text-lg font-semibold mb-4 flex items-center">
            <MapPin className="w-5 h-5 mr-2 text-primary-600" />
            Delivery Address
          </h2>
          <div className="space-y-2 text-sm">
            <p className="font-medium">{order.delivery_address}</p>
            <p className="text-gray-600">
              {order.delivery_city}, {order.delivery_state}
            </p>
          </div>
        </div>

        {/* Order Summary */}
        <div className="card">
          <h2 className="text-lg font-semibold mb-4">Order Summary</h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600">Subtotal:</span>
              <span className="font-medium">
                ₦
                {formatCurrency(
                  (order.total_amount ?? 0) - (order.shipping_fee_paid ?? 0)
                )}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Shipping:</span>
              <span className="font-medium">
                ₦{formatCurrency(order.shipping_fee_paid)}
              </span>
            </div>
            <div className="flex justify-between pt-2 border-t">
              <span className="font-semibold">Total:</span>
              <span className="font-bold text-lg text-primary-600">
                ₦{formatCurrency(order.total_amount)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Sub-Orders / Shipments */}
      <div className="mt-8">
        <h2 className="text-2xl font-bold mb-6">Shipments</h2>

        <div className="space-y-4">
          {subOrders.map((subOrder) => {
            const validShipment = hasValidShipment(subOrder);
            const shipmentError = hasShipmentError(subOrder);
            const displayTracking = getDisplayTracking(subOrder);
            const selectedLane = getSelectedLane(subOrder);
            const eligibleLanes = getEligibleLanes(subOrder);
            const fezLaneEligible = eligibleLanes.includes('fez');
            const localLaneEligible = eligibleLanes.includes('local_rider');
            const fezDisabledByLane = selectedLane === 'local_rider';
            const localDisabledByLane = selectedLane === 'fez';
            const isLocalRider = subOrder.couriers?.code?.toLowerCase() === 'local-rider';
            const canMarkOutForDelivery =
              isLocalRider && !['out_for_delivery', 'delivered'].includes(subOrder.status);
            const canMarkDelivered = isLocalRider && subOrder.status !== 'delivered';
            const items = subOrder.items ?? [];
            const itemsSubtotal = items.reduce(
              (sum, item) =>
                sum + Number(item.price || 0) * Number(item.quantity || 0),
              0
            );
            const allocatedShippingFee = Number(subOrder.allocated_shipping_fee || 0);
            const estimatedCourierCost = Number(subOrder.real_shipping_cost || 0);
            const shippingMargin = allocatedShippingFee - estimatedCourierCost;

            return (
              <div key={subOrder.id} className="card">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="font-semibold text-lg flex items-center gap-2">
                      <Truck className="w-5 h-5 text-primary-600" />
                      {subOrder.hubs?.name || 'Unknown Hub'} -{' '}
                      {subOrder.couriers?.name || 'Courier'}
                    </h3>
                    <p className="text-sm text-gray-600 mt-1">
                      {subOrder.hubs?.city || 'Unknown City'} | Customer shipping share: ₦
                      {formatCurrency(allocatedShippingFee)}
                    </p>
                  </div>
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(
                      subOrder.status
                    )}`}
                  >
                    {subOrder.status}
                  </span>
                </div>

                {/* ITEMS TO PACK SECTION */}
                {items.length > 0 && (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Box className="w-5 h-5 text-green-600" />
                      <h4 className="font-semibold text-green-900">
                        Items to Pack for {subOrder.hubs?.name || 'Hub'}
                      </h4>
                    </div>
                    <div className="space-y-2">
                      {items.map((item, idx) => {
                        const variationLabel = formatVariationForOrderItem(item);
                        return (
                        <div
                          key={idx}
                          className="flex items-start justify-between bg-white p-3 rounded-md border border-green-100"
                        >
                          <div className="flex-1">
                            <p className="font-medium text-gray-900">
                              <span className="inline-block bg-green-600 text-white text-xs font-bold px-2 py-1 rounded mr-2">
                                {item.quantity ?? 0}x
                              </span>
                              {item.name}
                            </p>
                            <div className="text-xs text-gray-600 mt-1 space-y-1">
                              {variationLabel && (
                                <p className="text-purple-800 font-medium">
                                  Variation: {variationLabel}
                                </p>
                              )}
                              {item.sku && <p>SKU: {item.sku}</p>}
                              {item.weight !== undefined && (
                                <p>Weight: {item.weight}kg per unit</p>
                              )}
                              {item.price !== undefined && (
                                <p className="text-blue-600 font-semibold">
                                  ₦{Number(item.price).toLocaleString()} per unit
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="text-right ml-4">
                            {item.price !== undefined &&
                              item.quantity !== undefined && (
                                <>
                                  <p className="text-lg font-bold text-gray-900">
                                    ₦
                                    {Number(
                                      item.price * item.quantity
                                    ).toLocaleString()}
                                  </p>
                                  <p className="text-xs text-gray-600">
                                    Total
                                  </p>
                                </>
                              )}
                          </div>
                        </div>
                        );
                      })}
                    </div>

                    <div className="mt-3 pt-3 border-t border-green-200 space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="font-semibold text-green-900">
                          Total Items:
                        </span>
                        <span className="font-bold text-green-900">
                          {items.reduce(
                            (sum, item) => sum + (item.quantity || 0),
                            0
                          )}{' '}
                          pieces
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="font-semibold text-green-900">
                          Total Weight:
                        </span>
                        <span className="font-bold text-green-900">
                          {items
                            .reduce(
                              (sum, item) =>
                                sum +
                                Number(item.weight || 0) *
                                  Number(item.quantity || 0),
                              0
                            )
                            .toFixed(2)}
                          kg
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="font-semibold text-green-900">
                          Items Subtotal:
                        </span>
                        <span className="font-bold text-lg text-green-900">
                          ₦
                          {itemsSubtotal.toLocaleString()}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="font-semibold text-green-900">
                          Customer Shipping Share:
                        </span>
                        <span className="font-bold text-lg text-green-900">
                          ₦{formatCurrency(allocatedShippingFee)}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="font-semibold text-green-900">
                          Estimated Courier Cost:
                        </span>
                        <span className="font-bold text-green-900">
                          ₦{formatCurrency(estimatedCourierCost)}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="font-semibold text-green-900">
                          Shipping Margin:
                        </span>
                        <span className="font-bold text-green-900">
                          ₦{formatCurrency(shippingMargin)}
                        </span>
                      </div>
                      <div className="flex justify-between pt-2 border-t border-green-300">
                        <span className="font-bold text-green-900">
                          Sub-Order Total:
                        </span>
                        <span className="font-bold text-xl text-green-600">
                          ₦
                          {(itemsSubtotal + allocatedShippingFee).toLocaleString()}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Courier Integration Section */}
                {(subOrder.couriers?.api_enabled ||
                  subOrder.couriers?.code?.toLowerCase() === 'fez') && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                    <div className="flex items-center gap-2 mb-3">
                      <CheckCircle className="w-4 h-4 text-blue-600" />
                      <span className="text-sm font-medium text-blue-900">
                        Courier API Integration (
                        {subOrder.couriers?.name || 'Fez Delivery'})
                      </span>
                    </div>

                    <div className="mb-3">
                      <label className="block text-xs font-semibold text-blue-900 mb-1">
                        Shipment Lane
                      </label>
                      <select
                        value={selectedLane}
                        onChange={async (event) => {
                          const value = event.target.value === 'local_rider' ? 'local_rider' : 'fez';
                          await updateShipmentLane(subOrder, value);
                        }}
                        className="w-full border border-blue-200 rounded-md px-2 py-2 text-sm bg-white"
                      >
                        {eligibleLanes.map((lane) => (
                          <option key={lane} value={lane}>
                            {lane === 'fez' ? 'Fez' : 'Local Rider'}
                          </option>
                        ))}
                      </select>
                      <p className="text-xs text-blue-700 mt-1">
                        Selected lane: {selectedLane === 'fez' ? 'Fez' : 'Local Rider'}.
                      </p>
                    </div>

                    {/* Show error alert if previous attempt failed */}
                    {shipmentError && (
                      <div className="bg-red-50 border border-red-200 rounded-md p-3 mb-3 flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="text-sm font-medium text-red-800">
                            Previous shipment creation failed
                          </p>
                          <p className="text-xs text-red-600 mt-1">
                            {subOrder.tracking_number ||
                              subOrder.courier_waybill}
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Always show all buttons - simplified flow */}
                    <div className="space-y-3">
                      {/* Tracking Info - only show if we have a real Fez tracking number */}
                      {displayTracking && (
                        <div className="grid grid-cols-2 gap-3 text-sm">
                          <div>
                            <span className="text-gray-600">
                              Courier Tracking:
                            </span>
                            <p className="font-medium font-mono">
                              {displayTracking}
                            </p>
                          </div>
                          <div>
                            <span className="text-gray-600">Shipment ID:</span>
                            <p className="font-medium text-xs font-mono">
                              {subOrder.courier_shipment_id ||
                                'Not yet created'}
                            </p>
                          </div>
                        </div>
                      )}

                      {/* All Action Buttons */}
                      <div className="flex flex-wrap gap-2">
                        {!subOrder.delivery_person_name && (
                          <div className="relative dispatch-dropdown">
                            <button
                              onClick={() =>
                                setShowDispatchMenu((prev) =>
                                  prev === subOrder.id ? null : subOrder.id
                                )
                              }
                              className="btn-primary flex items-center gap-2 text-sm"
                            >
                              Dispatch Order
                              <svg
                                className="w-4 h-4"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M19 9l-7 7-7-7"
                                />
                              </svg>
                            </button>

                            {showDispatchMenu === subOrder.id && (
                              <div className="absolute top-full left-0 mt-1 w-64 bg-white border rounded-lg shadow-lg z-10">
                                <button
                                  onClick={async () => {
                                    setShowDispatchMenu(null);
                                    if (!fezLaneEligible || fezDisabledByLane) {
                                      return;
                                    }
                                    if (validShipment) {
                                      const confirmed = window.confirm(
                                        'This will create a new Fez shipment and replace the current tracking. Continue?'
                                      );
                                      if (!confirmed) return;
                                    }
                                    await createCourierShipment(subOrder, {
                                      force: validShipment,
                                    });
                                  }}
                                  disabled={!fezLaneEligible || fezDisabledByLane}
                                  className={`w-full px-4 py-3 text-left border-b flex items-start gap-3 ${
                                    !fezLaneEligible || fezDisabledByLane
                                      ? 'opacity-50 cursor-not-allowed bg-gray-50'
                                      : 'hover:bg-gray-50'
                                  }`}
                                >
                                  <div className="mt-1">
                                    <svg
                                      className="w-5 h-5 text-blue-600"
                                      fill="none"
                                      stroke="currentColor"
                                      viewBox="0 0 24 24"
                                    >
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"
                                      />
                                    </svg>
                                  </div>
                                  <div>
                                    <div className="font-semibold">Send to Fez</div>
                                    <div className="text-xs text-gray-600">
                                      API courier with tracking
                                    </div>
                                  </div>
                                </button>

                                <button
                                  onClick={async () => {
                                    setShowDispatchMenu(null);
                                    if (!localLaneEligible || localDisabledByLane) {
                                      return;
                                    }
                                    const laneUpdated = await updateShipmentLane(
                                      subOrder,
                                      'local_rider'
                                    );
                                    if (!laneUpdated) return;
                                    setShowRiderModal(subOrder.id);
                                    setRiderInfo({ name: '', phone: '', vehicle: '' });
                                  }}
                                  disabled={!localLaneEligible || localDisabledByLane}
                                  className={`w-full px-4 py-3 text-left flex items-start gap-3 ${
                                    !localLaneEligible || localDisabledByLane
                                      ? 'opacity-50 cursor-not-allowed bg-gray-50'
                                      : 'hover:bg-gray-50'
                                  }`}
                                >
                                  <div className="mt-1">
                                    <svg
                                      className="w-5 h-5 text-green-600"
                                      fill="none"
                                      stroke="currentColor"
                                      viewBox="0 0 24 24"
                                    >
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                                      />
                                    </svg>
                                  </div>
                                  <div>
                                    <div className="font-semibold">
                                      Assign Local Rider
                                    </div>
                                    <div className="text-xs text-gray-600">
                                      Manual delivery (same state)
                                    </div>
                                  </div>
                                </button>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Track on Fez - only if valid tracking exists */}
                        {displayTracking && (
                          <a
                            href={`https://web.fezdelivery.co/track-delivery?tracking=${displayTracking}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn-secondary text-sm flex items-center"
                          >
                            <ExternalLink className="w-4 h-4 mr-2" />
                            Track on Fez
                          </a>
                        )}

                        {/* Update Tracking - only if valid tracking exists */}
                        {displayTracking && (
                          <button
                            onClick={() => fetchLiveTracking(subOrder.id)}
                            disabled={fetchingTracking === subOrder.id}
                            className="btn-secondary text-sm flex items-center"
                          >
                            {fetchingTracking === subOrder.id ? (
                              <>
                                <Loader className="w-4 h-4 mr-2 animate-spin" />
                                Fetching...
                              </>
                            ) : (
                              <>
                                <RefreshCw className="w-4 h-4 mr-2" />
                                Update Tracking
                              </>
                            )}
                          </button>
                        )}

                        {/* Print Label - always available */}
                        <button
                          onClick={() => printLabel(subOrder.id)}
                          className="btn-primary text-sm flex items-center"
                        >
                          <Printer className="w-4 h-4 mr-2" />
                          Print Label
                        </button>

                        {/* Download Label if URL exists */}
                        {subOrder.label_url && (
                          <button
                            onClick={() => downloadLabel(subOrder.label_url)}
                            className="btn-secondary text-sm flex items-center"
                          >
                            <Download className="w-4 h-4 mr-2" />
                            Download Label
                          </button>
                        )}

                        {/* Download Waybill if URL exists */}
                        {subOrder.waybill_url && (
                          <button
                            onClick={() => downloadLabel(subOrder.waybill_url)}
                            className="btn-secondary text-sm flex items-center"
                          >
                            <Download className="w-4 h-4 mr-2" />
                            Download Waybill
                          </button>
                        )}
                      </div>

                      {/* Already Dispatched - Show Method */}
                      {(subOrder.tracking_number || subOrder.delivery_person_name) && (
                        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                          {subOrder.tracking_number && (
                            <div>
                              <span className="font-semibold">JLO Tracking:</span>{' '}
                              {subOrder.tracking_number}
                            </div>
                          )}
                          {subOrder.delivery_person_name && (
                            <div className="mt-1">
                              <span className="font-semibold">Local Rider:</span>{' '}
                              {subOrder.delivery_person_name}{' '}
                              {subOrder.delivery_person_phone && (
                                <>({subOrder.delivery_person_phone})</>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {subOrder.last_tracking_update && (
                        <p className="text-xs text-gray-500">
                          Last updated:{' '}
                          {new Date(
                            subOrder.last_tracking_update
                          ).toLocaleString()}
                        </p>
                      )}

                      {/* Tracking Timeline - Horizontal Progress Stepper */}
                      <TrackingTimeline status={subOrder.status} />
                    </div>
                  </div>
                )}

                {isLocalRider && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4 space-y-3">
                    <p className="text-sm text-yellow-900 font-semibold">
                      Manual local delivery status
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {canMarkOutForDelivery && (
                        <button
                          onClick={() => updateLocalDeliveryStatus(subOrder.id, 'out_for_delivery')}
                          disabled={statusUpdating === subOrder.id}
                          className="btn-secondary text-sm flex items-center gap-2"
                        >
                          {statusUpdating === subOrder.id ? (
                            <Loader className="w-4 h-4 animate-spin" />
                          ) : (
                            <Truck className="w-4 h-4" />
                          )}
                          Mark Out for Delivery
                        </button>
                      )}
                      {canMarkDelivered && (
                        <button
                          onClick={() => updateLocalDeliveryStatus(subOrder.id, 'delivered')}
                          disabled={statusUpdating === subOrder.id}
                          className="btn-primary text-sm flex items-center gap-2"
                        >
                          {statusUpdating === subOrder.id ? (
                            <Loader className="w-4 h-4 animate-spin" />
                          ) : (
                            <CheckCircle className="w-4 h-4" />
                          )}
                          Mark Delivered
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-yellow-700">
                      These buttons let dispatchers manually progress the tracking
                      status once a local rider picks up or delivers the goods.
                    </p>
                  </div>
                )}

                {/* Manual Tracking (if API not enabled) */}
                {!(
                  subOrder.couriers?.api_enabled ||
                  subOrder.couriers?.code?.toLowerCase() === 'fez'
                ) && (
                  <div className="bg-gray-50 rounded-lg p-4">
                    <p className="text-sm text-gray-600 mb-2">
                      Manual Tracking Number:
                    </p>
                    <p className="font-mono font-semibold text-lg">
                      {subOrder.tracking_number || 'Not assigned'}
                    </p>
                    <div className="mt-3">
                      <button
                        onClick={() => printLabel(subOrder.id)}
                        disabled={!subOrder.tracking_number}
                        className="btn-secondary text-sm flex items-center disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        <Printer className="w-4 h-4 mr-2" />
                        Print Label
                      </button>
                    </div>
                    <p className="text-xs text-gray-500 mt-2">
                      Enable API integration in Courier Settings for automatic
                      shipment creation
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Returns & Refunds - Rest of the component continues... */}
      <div className="mt-10">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Package className="w-5 h-5 text-primary-600" />
            Returns & Refunds
          </h2>
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600">Filter:</label>
            <select
              className="border rounded px-2 py-1 text-sm"
              value={trackingFilter}
              onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                setTrackingFilter(e.target.value as 'all' | 'with' | 'without')
              }
            >
              <option value="all">All</option>
              <option value="with">Has Tracking</option>
              <option value="without">No Tracking</option>
            </select>
          </div>
        </div>

        {returnShipments.length === 0 ? (
          <p className="text-gray-600 text-sm">No returns for this order.</p>
        ) : (
          <div className="space-y-4">
            {returnShipments
              .filter((r) => {
                const hasTracking =
                  (r.tracking_number && r.tracking_number !== '') ||
                  (r.fez_tracking && r.fez_tracking !== '');
                if (trackingFilter === 'with') return !!hasTracking;
                if (trackingFilter === 'without') return !hasTracking;
                return true;
              })
              .map((ret) => {
                const tracking =
                  ret.tracking_number ??
                  ret.fez_tracking ??
                  null;

                return (
                  <div key={ret.id} className="card">
                    {/* Return details UI - keeping the rest of the returns section unchanged */}
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                      <div>
                        <p className="text-sm text-gray-600">Return Code</p>
                        <p className="font-mono font-semibold text-lg">
                          {ret.return_code || '—'}
                        </p>
                        <p className="text-sm text-gray-600 mt-1">
                          Method:{' '}
                          {ret.method === 'pickup'
                            ? 'Pickup (Fez)'
                            : 'Drop-off'}
                        </p>
                        <p className="text-sm text-gray-600">
                          Resolution:{' '}
                          {ret.return_request?.preferred_resolution || '—'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`px-3 py-1 rounded-full text-xs font-semibold ${getReturnStatusColor(
                            ret.status || ''
                          )}`}
                        >
                          {formatStatusText(ret.status)}
                        </span>
                        {tracking ? (
                          <span className="text-xs px-3 py-1 rounded-full bg-green-100 text-green-800 font-medium">
                            Tracking: {tracking}
                          </span>
                        ) : (
                          <span className="text-xs px-3 py-1 rounded-full bg-gray-100 text-gray-700">
                            Awaiting tracking
                          </span>
                        )}
                      </div>
                    </div>
                    {/* Rest of the returns section continues unchanged... */}
                  </div>
                );
              })}
          </div>
        )}
      </div>
      {/* Rider Assignment Modal */}
      {showRiderModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-bold mb-4">Assign Local Rider</h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">
                  Rider Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={riderInfo.name}
                  onChange={(e) => setRiderInfo({ ...riderInfo, name: e.target.value })}
                  className="w-full px-3 py-2 border rounded"
                  placeholder="Enter rider name"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  Phone Number <span className="text-red-500">*</span>
                </label>
                <input
                  type="tel"
                  value={riderInfo.phone}
                  onChange={(e) => setRiderInfo({ ...riderInfo, phone: e.target.value })}
                  className="w-full px-3 py-2 border rounded"
                  placeholder="+234 800 000 0000"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Vehicle Type</label>
                <select
                  value={riderInfo.vehicle}
                  onChange={(e) => setRiderInfo({ ...riderInfo, vehicle: e.target.value })}
                  className="w-full px-3 py-2 border rounded"
                >
                  <option value="">Select vehicle</option>
                  <option value="Motorcycle">Motorcycle</option>
                  <option value="Bicycle">Bicycle</option>
                  <option value="Van">Van</option>
                  <option value="Car">Car</option>
                </select>
              </div>
            </div>

            <div className="flex gap-2 mt-6">
              <button
                onClick={() => {
                  setShowRiderModal(null);
                  setRiderInfo({ name: '', phone: '', vehicle: '' });
                }}
                className="flex-1 px-4 py-2 border rounded hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => assignLocalRider(showRiderModal)}
                disabled={!riderInfo.name || !riderInfo.phone}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Assign Rider
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
