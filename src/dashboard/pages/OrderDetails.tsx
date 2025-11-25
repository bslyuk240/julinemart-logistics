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
} from 'lucide-react';
import { useNotification } from '../contexts/NotificationContext';
import { TrackingTimeline, type TrackingEvent } from '../../components/TrackingTimeline';

type Identifier = string | number;
type KnownStatus = 'pending' | 'processing' | 'in_transit' | 'pending_pickup' | 'delivered' | 'cancelled';

type Hub = {
  name?: string;
  city?: string;
};

type Courier = {
  name?: string;
};

type SubOrder = {
  id: Identifier;
  hubs?: Hub;
  couriers?: Courier;
  real_shipping_cost?: number;
  status: string;
  tracking_number?: string;
  courier_waybill?: string;
  courier_tracking_url?: string;
  tracking_events?: TrackingEvent[];
};

type Order = {
  id: Identifier;
  woocommerce_order_id: string;
  created_at: string;
  overall_status: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  delivery_address: string;
  delivery_city: string;
  delivery_state: string;
  total_amount: number;
  shipping_fee_paid: number;
  sub_orders: SubOrder[];
};

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
  const [downloading, setDownloading] = useState<string | null>(null); // for label/waybill

  // helper: format currency
  const formatCurrency = (value: number | string | null | undefined): string => {
    return Number(value || 0).toLocaleString();
  };

  // fetch order + sub-orders
  const fetchOrderDetails = async (): Promise<void> => {
    try {
      const response = await fetch(`${apiBase}/api/orders/${id}`);
      const data: { success: boolean; data: Order } = await response.json();
      
      if (data.success) {
        setOrder(data.data);
        setSubOrders(data.data.sub_orders || []);
      }
    } catch (error) {
      console.error('Error fetching order:', error);
      notification.error('Failed to Load', 'Unable to fetch order details');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrderDetails();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // create fez shipment (refresh + instant ui update)
  const createCourierShipment = async (subOrderId: Identifier): Promise<void> => {
    setCreatingShipment(subOrderId);
    
    try {
      const response = await fetch(`${apiBase}/.netlify/functions/fez-create-shipment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subOrderId }),
      });

      const data = await response.json();

      if (data.success) {
        const track = data.data.tracking_number;
        const url = data.data.courier_tracking_url;

        notification.success("Shipment Created!", `Tracking: ${track}`);

        setSubOrders((prev) =>
          prev.map((so) =>
            so.id === subOrderId
              ? {
                  ...so,
                  tracking_number: track,
                  courier_waybill: track,
                  courier_tracking_url: url,
                  status: "pending_pickup",
                }
              : so
          )
        );

        await fetchOrderDetails();

      } else {
        notification.error('Creation Failed', data.message || data.error);
      }

    } catch (error) {
      console.error("Shipment Error", error);
      notification.error("Error", "Failed to create shipment on FEZ");
    } finally {
      setCreatingShipment(null);
    }
  };

  // fetch live tracking
  const fetchLiveTracking = async (subOrderId: Identifier): Promise<void> => {
    setFetchingTracking(subOrderId);
    
    try {
      const response = await fetch(`${apiBase}/.netlify/functions/fez-fetch-tracking?subOrderId=${subOrderId}`);
      const data = await response.json();

      if (data.success) {
        notification.success(
          'Tracking Updated',
          `Status: ${data.data.status || 'In Transit'}`
        );

        await fetchOrderDetails();
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

  // print label (existing generate-label function)
  const downloadLabel = async (subOrderId: Identifier): Promise<void> => {
    setDownloading(`label-${subOrderId}`);
    try {
      const res = await fetch(`${apiBase}/.netlify/functions/generate-label`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subOrderId }),
      });

      if (!res.ok) {
        throw new Error('Failed to generate label');
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      window.open(url, '_blank');
    } catch (error) {
      console.error('Label error', error);
      notification.error('Label Error', 'Failed to generate shipping label');
    } finally {
      setDownloading(null);
    }
  };

  // print waybill (new generate-waybill function)
  const downloadWaybill = async (subOrderId: Identifier): Promise<void> => {
    setDownloading(`waybill-${subOrderId}`);
    try {
      const res = await fetch(`${apiBase}/.netlify/functions/generate-waybill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subOrderId }),
      });

      if (!res.ok) {
        throw new Error('Failed to generate waybill');
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      window.open(url, '_blank');
    } catch (error) {
      console.error('Waybill error', error);
      notification.error('Waybill Error', 'Failed to generate waybill');
    } finally {
      setDownloading(null);
    }
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
      processing: 'bg-blue-100 text-blue-800',
      in_transit: 'bg-purple-100 text-purple-800',
      pending_pickup: 'bg-orange-100 text-orange-800',
      delivered: 'bg-green-100 text-green-800',
      cancelled: 'bg-red-100 text-red-800',
    };
    return colors[status as KnownStatus] || 'bg-gray-100 text-gray-800';
  };

  const getLastUpdate = (subOrder: SubOrder): string | undefined => {
    const events = subOrder.tracking_events || [];
    const latest = events.reduce<TrackingEvent | null>((acc, curr) => {
      if (!acc) return curr;
      return new Date(curr.event_time) > new Date(acc.event_time) ? curr : acc;
    }, null);
    return latest?.event_time;
  };

  return (
    <div className="order-details-container">

      {/* BACK BUTTON */}
      <button
        onClick={() => navigate('/admin/orders')}
        className="flex items-center text-gray-600 hover:text-gray-900 mb-4"
      >
        <ArrowLeft className="w-5 h-5 mr-2" />
        Back to Orders
      </button>

      {/* ORDER HEADER */}
      <div className="flex items-center justify-between mb-8">
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

      {/* CUSTOMER + DELIVERY + SUMMARY */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Customer Info */}
        <div className="card">
          <h2 className="text-lg font-semibold mb-4 flex items-center">
            <User className="w-5 h-5 mr-2 text-primary-600" />
            Customer Information
          </h2>
          <div className="space-y-3 text-sm">
            <p><b>Name:</b> {order.customer_name}</p>
            <p><b>Email:</b> {order.customer_email}</p>
            <p><b>Phone:</b> {order.customer_phone}</p>
          </div>
        </div>

        {/* Delivery Info */}
        <div className="card">
          <h2 className="text-lg font-semibold mb-4 flex items-center">
            <MapPin className="w-5 h-5 mr-2 text-primary-600" />
            Delivery Address
          </h2>
          <div className="space-y-2 text-sm">
            <p>{order.delivery_address}</p>
            <p>{order.delivery_city}, {order.delivery_state}</p>
          </div>
        </div>

        {/* Order Summary */}
        <div className="card">
          <h2 className="text-lg font-semibold mb-4">Order Summary</h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span>Subtotal:</span>
              <span>₦{formatCurrency(order.total_amount - order.shipping_fee_paid)}</span>
            </div>
            <div className="flex justify-between">
              <span>Shipping:</span>
              <span>₦{formatCurrency(order.shipping_fee_paid)}</span>
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

      {/* SHIPMENTS */}
      <div className="mt-10">
        <h2 className="text-2xl font-bold mb-6">Shipments</h2>

        <div className="space-y-4">
          {subOrders.map((subOrder) => (
            <div key={subOrder.id} className="card">

              {/* SHIPMENT HEADER */}
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="font-semibold text-lg flex items-center gap-2">
                    <Truck className="w-5 h-5 text-primary-600" />
                    {subOrder.hubs?.name} - {subOrder.couriers?.name}
                  </h3>
                  <p className="text-sm text-gray-600 mt-1">
                    {subOrder.hubs?.city} | Shipping: ₦{formatCurrency(subOrder.real_shipping_cost)}
                  </p>
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(subOrder.status)}`}>
                  {subOrder.status}
                </span>
              </div>

              {/* COURIER API SECTION */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-3">
                  <CheckCircle className="w-4 h-4 text-blue-600" />
                  <span className="text-sm font-medium text-blue-900">
                    Courier API Active ({subOrder.couriers?.name})
                  </span>
                </div>

                {/* IF NOT YET SENT TO FEZ */}
                {!subOrder.tracking_number ? (
                  <button
                    onClick={() => createCourierShipment(subOrder.id)}
                    disabled={creatingShipment === subOrder.id}
                    className="btn-primary text-sm flex items-center"
                  >
                    {creatingShipment === subOrder.id ? (
                      <>
                        <Loader className="w-4 h-4 mr-2 animate-spin" />
                        Creating Shipment...
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4 mr-2" />
                        Send to {subOrder.couriers?.name}
                      </>
                    )}
                  </button>
                ) : (
                  /* SHIPMENT CREATED - DISPLAY TRACKING INFO */
                  <div className="space-y-4">

                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <span className="text-gray-600">Tracking Number:</span>
                        <p className="font-semibold">{subOrder.tracking_number}</p>
                      </div>

                      <div>
                        <span className="text-gray-600">Shipment ID:</span>
                        <p className="font-medium">{subOrder.courier_waybill || subOrder.tracking_number}</p>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {subOrder.courier_tracking_url && (
                        <a
                          href={subOrder.courier_tracking_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn-secondary flex items-center text-sm"
                        >
                          <ExternalLink className="w-4 h-4 mr-2" />
                          Track on Fez
                        </a>
                      )}

                      <button
                        onClick={() => fetchLiveTracking(subOrder.id)}
                        disabled={fetchingTracking === subOrder.id}
                        className="btn-secondary text-sm flex items-center"
                      >
                        {fetchingTracking === subOrder.id ? (
                          <>
                            <Loader className="w-4 h-4 mr-2 animate-spin" />
                            Updating...
                          </>
                        ) : (
                          <>
                            <Truck className="w-4 h-4 mr-2" />
                            Update Tracking
                          </>
                        )}
                      </button>

                      <button
                        onClick={() => downloadLabel(subOrder.id)}
                        disabled={downloading === `label-${subOrder.id}`}
                        className="btn-secondary text-sm flex items-center"
                      >
                        {downloading === `label-${subOrder.id}` ? (
                          <>
                            <Loader className="w-4 h-4 mr-2 animate-spin" />
                            Label...
                          </>
                        ) : (
                          <>
                            <Download className="w-4 h-4 mr-2" />
                            Print Label
                          </>
                        )}
                      </button>

                      <button
                        onClick={() => downloadWaybill(subOrder.id)}
                        disabled={downloading === `waybill-${subOrder.id}`}
                        className="btn-secondary text-sm flex items-center"
                      >
                        {downloading === `waybill-${subOrder.id}` ? (
                          <>
                            <Loader className="w-4 h-4 mr-2 animate-spin" />
                            Waybill...
                          </>
                        ) : (
                          <>
                            <Download className="w-4 h-4 mr-2" />
                            Print Waybill
                          </>
                        )}
                      </button>
                    </div>

                    <p className="text-xs text-gray-500">
                      Last updated: {getLastUpdate(subOrder)
                        ? new Date(getLastUpdate(subOrder) as string).toLocaleString()
                        : 'N/A'}
                    </p>
                  </div>
                )}
              </div>

              {/* TRACKING TIMELINE */}
              {subOrder.tracking_events && subOrder.tracking_events.length > 0 && (
                <div className="mt-4">
                  <h4 className="font-semibold text-gray-900 mb-2">Tracking Timeline</h4>
                  <TrackingTimeline events={subOrder.tracking_events} />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
