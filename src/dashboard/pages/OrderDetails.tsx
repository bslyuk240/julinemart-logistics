import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  MapPin,
  User,
  Truck,
  Download,
  ExternalLink,
  Send,
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
};

type SubOrder = {
  id: Identifier;
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
};

type ReturnShipment = {
  id: string;
  return_request_id?: string;
  fez_tracking?: string | null;
  method: 'pickup' | 'dropoff';
  return_code?: string;
  status?:
    | 'awaiting_tracking'
    | 'in_transit'
    | 'delivered_to_hub'
    | 'inspection_in_progress'
    | 'approved'
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
    customer_name?: string;
    customer_email?: string;
    preferred_resolution?: string;
    reason_code?: string;
    reason_note?: string;
    images?: string[];
    status?: string;
  };
};

type Order = {
  id: Identifier;
  woocommerce_order_id: string;
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
      'pending': 'pending',
      'pending_pickup': 'assigned',
      'assigned': 'assigned',
      'picked_up': 'picked_up',
      'in_transit': 'in_transit',
      'dispatched': 'in_transit',
      'out_for_delivery': 'out_for_delivery',
      'delivered': 'delivered',
      'processing': 'pending',
      'cancelled': 'cancelled',
      'returned': 'returned',
      'failed': 'failed',
    };
    return statusMap[s.toLowerCase()] || 'pending';
  };

  const currentStatus = normalizeStatus(status);
  const currentIndex = steps.findIndex(step => step.key === currentStatus);

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
                    ${isCompleted 
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
    'already exists'
  ];
  
  const lowerValue = value.toLowerCase();
  for (const indicator of errorIndicators) {
    if (lowerValue.includes(indicator)) {
      return false;
    }
  }
  
  // Reject auto-generated tracking numbers (these are NOT from Fez)
  // Format: FEZ-1234567890-ABCDEF or JLO-1234567890-ABCDEF
  if (/^(FEZ|JLO|CR)-\d+-[A-Z0-9]+$/i.test(value)) {
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
  return tracking.toLowerCase().includes('error') || 
         tracking.toLowerCase().includes('cannot') ||
         tracking.toLowerCase().includes('something went wrong');
}

export function OrderDetailsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const notification = useNotification();

  const apiBase = import.meta.env.VITE_API_BASE_URL || '';
  const [order, setOrder] = useState<Order | null>(null);
  const [subOrders, setSubOrders] = useState<SubOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [creatingShipment, setCreatingShipment] = useState<Identifier | null>(null);
  const [fetchingTracking, setFetchingTracking] = useState<Identifier | null>(null);
  const [returnShipments, setReturnShipments] = useState<ReturnShipment[]>([]);
  const [updatingReturnStatus, setUpdatingReturnStatus] = useState<string | null>(null);
  const [returnTrackingData, setReturnTrackingData] = useState<Record<string, any[]>>({});
  const [returnTrackingLoading, setReturnTrackingLoading] = useState<Record<string, boolean>>({});
  const [trackingInput, setTrackingInput] = useState<Record<string, string>>({});
  const [trackingFilter, setTrackingFilter] = useState<'all' | 'with' | 'without'>('all');

  const formatCurrency = (value?: number | null) => {
    const amount = typeof value === 'number' ? value : 0;
    return amount.toLocaleString();
  };

  const getAuthHeaders = async () => {
    const { data: { session } } = await supabase.auth.getSession();
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
      const response = await fetch(`${apiBase}/api/orders/${id}`, { headers });
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
              isRealFezTracking: isRealFezTrackingNumber(so.tracking_number)
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
    if (!id) return;
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`${apiBase}/api/return-shipments/order/${id}`, { headers });
      const data = await response.json();

      if (data?.success) {
        setReturnShipments(data.data || []);
      }
    } catch (error) {
      console.error('Error fetching return shipments:', error);
    }
  };

  const updateReturnShipmentStatus = async (shipmentId: string, status: string) => {
    setUpdatingReturnStatus(shipmentId);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`${apiBase}/api/return-shipments/${shipmentId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ status }),
      });

      const data = await response.json();
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || 'Failed to update return shipment');
      }

      setReturnShipments((prev) =>
        prev.map((shipment) =>
          shipmentId === shipment.id
            ? { ...shipment, status: data.data?.status || status }
            : shipment
        )
      );

      notification.success('Updated', 'Return shipment status updated');
    } catch (error) {
      console.error('Return shipment update error:', error);
      notification.error('Update failed', error instanceof Error ? error.message : 'Unable to update return shipment');
    } finally {
      setUpdatingReturnStatus(null);
    }
  };

  useEffect(() => {
    fetchOrderDetails();
    fetchReturnShipments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Poll tracking for in-transit returns
  useEffect(() => {
    const interval = setInterval(() => {
      returnShipments
        .filter((r) => r.status === 'in_transit' && r.return_request_id)
        .forEach((r) => fetchReturnTracking(r.return_request_id as string, r.id));
    }, 2 * 60 * 1000);
    return () => clearInterval(interval);
  }, [returnShipments]);

  const createCourierShipment = async (subOrderId: Identifier) => {
    setCreatingShipment(subOrderId);

    try {
      const response = await fetch(`${apiBase}/.netlify/functions/fez-create-shipment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subOrderId }),
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
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Refresh to get latest data from database
      await fetchOrderDetails();
    } catch (error) {
      console.error('Shipment Error', error);
      notification.error('Creation Failed', error instanceof Error ? error.message : 'Failed to create shipment on courier platform');
      
      // Refresh to show current state
      await fetchOrderDetails();
    } finally {
      setCreatingShipment(null);
    }
  };

  const fetchReturnTracking = async (returnRequestId: string, shipmentId: string) => {
    setReturnTrackingLoading((prev) => ({ ...prev, [shipmentId]: true }));
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`${apiBase}/api/returns/${returnRequestId}/tracking`, { headers });
      const data = await response.json();
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || 'Failed to fetch tracking');
      }
      setReturnTrackingData((prev) => ({ ...prev, [shipmentId]: data.data?.events || [] }));
      if (data.data?.latest_status === 'delivered') {
        setReturnShipments((prev) =>
          prev.map((r) => (r.id === shipmentId ? { ...r, status: 'delivered_to_hub' } : r))
        );
      }
    } catch (error) {
      console.error('Return tracking error', error);
      notification.error('Tracking failed', error instanceof Error ? error.message : 'Unable to fetch tracking');
    } finally {
      setReturnTrackingLoading((prev) => ({ ...prev, [shipmentId]: false }));
    }
  };

  const submitReturnTracking = async (shipmentId: string, returnRequestId?: string) => {
    const value = trackingInput[shipmentId];
    if (!value) return;
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`${apiBase}/api/return-shipments/${shipmentId}/tracking`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ tracking_number: value, courier: 'fez' }),
      });
      const data = await response.json();
      if (!response.ok || !data?.success) throw new Error(data?.error || 'Failed to save tracking');
      setReturnShipments((prev) =>
        prev.map((r) =>
          r.id === shipmentId
            ? { ...r, fez_tracking: value, customer_submitted_tracking: false, status: 'in_transit' }
            : r
        )
      );
      notification.success('Tracking saved', value);
      if (returnRequestId) fetchReturnTracking(returnRequestId, shipmentId);
    } catch (error) {
      console.error('Submit tracking error', error);
      notification.error('Save failed', error instanceof Error ? error.message : 'Unable to save tracking');
    }
  };

  const fetchLiveTracking = async (subOrderId: Identifier) => {
    setFetchingTracking(subOrderId);

    try {
      const response = await fetch(`${apiBase}/.netlify/functions/fez-fetch-tracking?subOrderId=${subOrderId}`);
      const data = await response.json();

      if (data.success) {
        notification.success('Tracking Updated', `Status: ${data.data.fez_status || data.data.status || 'Updated'}`);
        
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

  const printLabel = (subOrderId: Identifier) => {
    // Open the generate-label function in a new window with print=true
    const labelUrl = `${apiBase}/.netlify/functions/generate-label?subOrderId=${subOrderId}&print=true`;
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
              Order #{order.woocommerce_order_id}
            </h1>
            <p className="text-gray-600 mt-2">
              Placed on {new Date(order.created_at).toLocaleDateString()}
            </p>
          </div>
          <span className={`px-4 py-2 rounded-full text-sm font-medium ${getStatusColor(order.overall_status)}`}>
            {order.overall_status}
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
            <p className="text-gray-600">{order.delivery_city}, {order.delivery_state}</p>
          </div>
        </div>

        {/* Order Summary */}
        <div className="card">
          <h2 className="text-lg font-semibold mb-4">Order Summary</h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600">Subtotal:</span>
              <span className="font-medium">₦{formatCurrency((order.total_amount ?? 0) - (order.shipping_fee_paid ?? 0))}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Shipping:</span>
              <span className="font-medium">₦{formatCurrency(order.shipping_fee_paid)}</span>
            </div>
            <div className="flex justify-between pt-2 border-t">
              <span className="font-semibold">Total:</span>
              <span className="font-bold text-lg text-primary-600">₦{formatCurrency(order.total_amount)}</span>
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

            return (
              <div key={subOrder.id} className="card">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="font-semibold text-lg flex items-center gap-2">
                      <Truck className="w-5 h-5 text-primary-600" />
                      {subOrder.hubs?.name || 'Unknown Hub'} - {subOrder.couriers?.name || 'Courier'}
                    </h3>
                    <p className="text-sm text-gray-600 mt-1">
                      {subOrder.hubs?.city || 'Unknown City'} | Shipping: ₦{formatCurrency(subOrder.real_shipping_cost)}
                    </p>
                  </div>
                  <span className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(subOrder.status)}`}>
                    {subOrder.status}
                  </span>
                </div>

                {/* ITEMS TO PACK SECTION */}
                {subOrder.items && subOrder.items.length > 0 && (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Box className="w-5 h-5 text-green-600" />
                      <h4 className="font-semibold text-green-900">Items to Pack for {subOrder.hubs?.name || 'Hub'}</h4>
                    </div>
                    <div className="space-y-2">
                      {subOrder.items.map((item, idx) => (
                        <div key={idx} className="flex items-start justify-between bg-white p-3 rounded-md border border-green-100">
                          <div className="flex-1">
                            <p className="font-medium text-gray-900">
                              <span className="inline-block bg-green-600 text-white text-xs font-bold px-2 py-1 rounded mr-2">
                                {item.quantity ?? 0}x
                              </span>
                              {item.name}
                            </p>
                            <div className="text-xs text-gray-600 mt-1 space-y-1">
                              {item.sku && <p>SKU: {item.sku}</p>}
                              {item.weight !== undefined && <p>Weight: {item.weight}kg per unit</p>}
                              {item.price !== undefined && (
                                <p className="text-blue-600 font-semibold">
                                  ₦{Number(item.price).toLocaleString()} per unit
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="text-right ml-4">
                            {item.price !== undefined && item.quantity !== undefined && (
                              <>
                                <p className="text-lg font-bold text-gray-900">
                                  ₦{Number(item.price * item.quantity).toLocaleString()}
                                </p>
                                <p className="text-xs text-gray-600">Total</p>
                              </>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="mt-3 pt-3 border-t border-green-200 space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="font-semibold text-green-900">Total Items:</span>
                        <span className="font-bold text-green-900">
                          {subOrder.items.reduce((sum, item) => sum + (item.quantity || 0), 0)} pieces
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="font-semibold text-green-900">Total Weight:</span>
                        <span className="font-bold text-green-900">
                          {subOrder.items
                            .reduce((sum, item) => sum + (Number(item.weight || 0) * Number(item.quantity || 0)), 0)
                            .toFixed(2)}
                          kg
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="font-semibold text-green-900">Items Subtotal:</span>
                        <span className="font-bold text-lg text-green-900">
                          ₦{subOrder.items
                            .reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0)
                            .toLocaleString()}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="font-semibold text-green-900">Shipping Fee:</span>
                        <span className="font-bold text-lg text-green-900">
                          ₦{formatCurrency(subOrder.real_shipping_cost)}
                        </span>
                      </div>
                      <div className="flex justify-between pt-2 border-t border-green-300">
                        <span className="font-bold text-green-900">Sub-Order Total:</span>
                        <span className="font-bold text-xl text-green-600">
                          ₦{(
                            subOrder.items.reduce(
                              (sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0),
                              0
                            ) + (subOrder.real_shipping_cost || 0)
                          ).toLocaleString()}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Courier Integration Section */}
                {(subOrder.couriers?.api_enabled || subOrder.couriers?.code?.toLowerCase() === 'fez') && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                    <div className="flex items-center gap-2 mb-3">
                      <CheckCircle className="w-4 h-4 text-blue-600" />
                      <span className="text-sm font-medium text-blue-900">
                        Courier API Integration ({subOrder.couriers?.name || 'Fez Delivery'})
                      </span>
                    </div>

                    {/* Show error alert if previous attempt failed */}
                    {shipmentError && (
                      <div className="bg-red-50 border border-red-200 rounded-md p-3 mb-3 flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="text-sm font-medium text-red-800">Previous shipment creation failed</p>
                          <p className="text-xs text-red-600 mt-1">
                            {subOrder.tracking_number || subOrder.courier_waybill}
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
                            <span className="text-gray-600">Courier Tracking:</span>
                            <p className="font-medium font-mono">{displayTracking}</p>
                          </div>
                          <div>
                            <span className="text-gray-600">Shipment ID:</span>
                            <p className="font-medium text-xs font-mono">
                              {subOrder.courier_shipment_id || 'Not yet created'}
                            </p>
                          </div>
                        </div>
                      )}

                      {/* All Action Buttons */}
                      <div className="flex flex-wrap gap-2">
                        {/* Send to Fez - Always visible */}
                        <button
                          onClick={() => createCourierShipment(subOrder.id)}
                          disabled={creatingShipment === subOrder.id}
                          className={`text-sm flex items-center ${
                            validShipment ? 'btn-secondary' : 'btn-primary'
                          }`}
                        >
                          {creatingShipment === subOrder.id ? (
                            <>
                              <Loader className="w-4 h-4 mr-2 animate-spin" />
                              Creating...
                            </>
                          ) : validShipment ? (
                            <>
                              <RefreshCw className="w-4 h-4 mr-2" />
                              Resend to Fez
                            </>
                          ) : (
                            <>
                              <Send className="w-4 h-4 mr-2" />
                              Send to Fez
                            </>
                          )}
                        </button>

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

                      {subOrder.last_tracking_update && (
                        <p className="text-xs text-gray-500">
                          Last updated: {new Date(subOrder.last_tracking_update).toLocaleString()}
                        </p>
                      )}

                      {/* Tracking Timeline - Horizontal Progress Stepper */}
                      <TrackingTimeline status={subOrder.status} />
                    </div>
                  </div>
                )}

                {/* Manual Tracking (if API not enabled) */}
                {!(subOrder.couriers?.api_enabled || subOrder.couriers?.code?.toLowerCase() === 'fez') && (
                  <div className="bg-gray-50 rounded-lg p-4">
                    <p className="text-sm text-gray-600 mb-2">Manual Tracking Number:</p>
                    <p className="font-mono font-semibold text-lg">{subOrder.tracking_number || 'Not assigned'}</p>
                    <p className="text-xs text-gray-500 mt-2">
                      Enable API integration in Courier Settings for automatic shipment creation
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Returns & Refunds */}
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
              onChange={(e) => setTrackingFilter(e.target.value as any)}
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
                if (trackingFilter === 'with') return !!r.fez_tracking;
                if (trackingFilter === 'without') return !r.fez_tracking;
                return true;
              })
              .map((ret) => {
                const submittedLabel = ret.customer_submitted_tracking ? 'Customer' : 'Admin';
                const events = returnTrackingData[ret.id] || [];
                return (
                  <div key={ret.id} className="card">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                      <div>
                        <p className="text-sm text-gray-600">Return Code</p>
                        <p className="font-mono font-semibold text-lg">{ret.return_code || '—'}</p>
                        <p className="text-sm text-gray-600 mt-1">
                          Method: {ret.method === 'pickup' ? 'Pickup (Fez)' : 'Drop-off'}
                        </p>
                        <p className="text-sm text-gray-600">
                          Resolution: {ret.return_request?.preferred_resolution || '—'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getReturnStatusColor(ret.status || '')}`}>
                          {ret.status || 'pending'}
                        </span>
                        {ret.fez_tracking ? (
                          <span className="text-xs px-3 py-1 rounded-full bg-green-100 text-green-800 font-medium">
                            Tracking: {ret.fez_tracking}
                          </span>
                        ) : (
                          <span className="text-xs px-3 py-1 rounded-full bg-gray-100 text-gray-700">
                            Awaiting tracking
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-gray-700">
                      <div>
                        <p className="font-medium">Reason</p>
                        <p className="text-gray-600">
                          {ret.return_request?.reason_code || '—'}
                          {ret.return_request?.reason_note ? ` - ${ret.return_request.reason_note}` : ''}
                        </p>
                        {ret.return_request?.images?.length ? (
                          <div className="flex gap-2 mt-2">
                            {ret.return_request.images.slice(0, 3).map((img, idx) => (
                              <a key={idx} href={img} target="_blank" rel="noreferrer" className="w-16 h-16 bg-gray-100 rounded overflow-hidden block">
                                <img src={img} alt="Return" className="w-full h-full object-cover" />
                              </a>
                            ))}
                          </div>
                        ) : null}
                      </div>

                      <div className="bg-gray-50 rounded-lg p-3">
                        <p className="font-semibold text-gray-800 mb-2">Shipping Information</p>
                        {ret.fez_tracking ? (
                          <>
                            <p className="text-sm">
                              Tracking: <span className="font-mono font-semibold">{ret.fez_tracking}</span>
                            </p>
                            <p className="text-xs text-gray-600 mt-1">
                              Submitted by: {submittedLabel}
                              {ret.tracking_submitted_at ? ` • ${new Date(ret.tracking_submitted_at).toLocaleString()}` : ''}
                            </p>
                            <div className="flex flex-wrap gap-2 mt-3">
                              <button
                                onClick={() => ret.return_request_id && fetchReturnTracking(ret.return_request_id, ret.id)}
                                disabled={returnTrackingLoading[ret.id]}
                                className="btn-secondary text-xs"
                              >
                                {returnTrackingLoading[ret.id] ? 'Loading...' : 'Track Shipment'}
                              </button>
                              {ret.status === 'in_transit' && (
                                <button
                                  onClick={() => updateReturnShipmentStatus(ret.id, 'delivered_to_hub')}
                                  disabled={updatingReturnStatus === ret.id}
                                  className="btn-primary text-xs"
                                >
                                  {updatingReturnStatus === ret.id ? 'Updating...' : 'Mark Received'}
                                </button>
                              )}
                              {ret.status === 'delivered_to_hub' && (
                                <button
                                  onClick={() => updateReturnShipmentStatus(ret.id, 'inspection_in_progress')}
                                  disabled={updatingReturnStatus === ret.id}
                                  className="btn-secondary text-xs"
                                >
                                  {updatingReturnStatus === ret.id ? 'Updating...' : 'Start Inspection'}
                                </button>
                              )}
                            </div>
                          </>
                        ) : (
                          <>
                            <p className="text-sm text-gray-700">Awaiting customer to submit tracking number.</p>
                            <div className="flex gap-2 mt-3">
                              <input
                                className="border rounded px-2 py-1 text-sm flex-1"
                                placeholder="Enter Fez tracking number"
                                value={trackingInput[ret.id] || ''}
                                onChange={(e) => setTrackingInput((prev) => ({ ...prev, [ret.id]: e.target.value }))}
                              />
                              <button
                                onClick={() => submitReturnTracking(ret.id, ret.return_request_id)}
                                className="btn-primary text-xs"
                              >
                                Save
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Timeline */}
                    {events.length > 0 && (
                      <div className="mt-4 bg-white border border-gray-200 rounded-lg p-3">
                        <p className="text-sm font-semibold mb-2">Tracking Timeline</p>
                        <div className="space-y-2">
                          {events.map((ev, idx) => (
                            <div key={idx} className="flex items-start gap-2 text-sm">
                              <div className="w-2 h-2 mt-1 rounded-full bg-blue-500" />
                              <div>
                                <p className="font-medium text-gray-900">{ev.status || ev.message || 'Update'}</p>
                                <p className="text-xs text-gray-600">
                                  {ev.timestamp ? new Date(ev.timestamp).toLocaleString() : ''}
                                  {ev.location ? ` • ${ev.location}` : ''}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        )}
      </div>
    </div>
  );
}
