import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, Package, MapPin, User, Phone, Mail, Calendar,
  Truck, Download, ExternalLink, Send, Loader, CheckCircle, Box
} from 'lucide-react';
import { useNotification } from '../contexts/NotificationContext';

interface Order {
  id: string;
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
}

interface SubOrder {
  id: string;
  tracking_number: string;
  status: string;
  real_shipping_cost: number;
  allocated_shipping_fee: number;
  estimated_delivery_date: string;
  courier_shipment_id: string;
  courier_tracking_url: string;
  label_url: string;
  waybill_url: string;
  last_tracking_update: string;
  items: Array<{
    sku: string;
    name: string;
    quantity: number;
    weight: number;
    price: number;
  }>;
  hubs: {
    name: string;
    city: string;
  };
  couriers: {
    id: string;
    name: string;
    code: string;
    api_enabled: boolean;
  };
}

export function OrderDetailsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const notification = useNotification();
  
  const apiBase = import.meta.env.VITE_API_BASE_URL || '';
  const formatCurrency = (value?: number | null) => {
    const amount = typeof value === 'number' ? value : 0;
    return amount.toLocaleString();
  };

  const [order, setOrder] = useState<Order | null>(null);
  const [subOrders, setSubOrders] = useState<SubOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [creatingShipment, setCreatingShipment] = useState<string | null>(null);
  const [fetchingTracking, setFetchingTracking] = useState<string | null>(null);

  useEffect(() => {
    fetchOrderDetails();
  }, [id]);

  const fetchOrderDetails = async () => {
    try {
      const response = await fetch(`${apiBase}/api/orders/${id}`);
      const data = await response.json();
      
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

  const createCourierShipment = async (subOrderId: string) => {
    setCreatingShipment(subOrderId);
    
    try {
      const response = await fetch(`${apiBase}/api/courier/create-shipment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subOrderId }),
      });

      const data = await response.json();

      if (data.success) {
        notification.success(
          'Shipment Created!',
          `Tracking: ${data.data.tracking_number}`
        );
        fetchOrderDetails();
      } else {
        notification.error('Creation Failed', data.error || 'Unable to create shipment');
      }
    } catch (error) {
      notification.error('Error', 'Failed to create shipment on courier platform');
    } finally {
      setCreatingShipment(null);
    }
  };

  const fetchLiveTracking = async (subOrderId: string) => {
    setFetchingTracking(subOrderId);
    
    try {
      const response = await fetch(`${apiBase}/api/courier/tracking/${subOrderId}`);
      const data = await response.json();

      if (data.success) {
        notification.success(
          'Tracking Updated',
          `Status: ${data.data.status || 'In Transit'}`
        );
        fetchOrderDetails();
      } else {
        notification.error('Tracking Failed', data.error || 'Unable to fetch tracking');
      }
    } catch (error) {
      notification.error('Error', 'Failed to fetch live tracking');
    } finally {
      setFetchingTracking(null);
    }
  };

  const downloadLabel = (labelUrl: string) => {
    window.open(labelUrl, '_blank');
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
    const colors: Record<string, string> = {
      pending: 'bg-yellow-100 text-yellow-800',
      processing: 'bg-blue-100 text-blue-800',
      in_transit: 'bg-purple-100 text-purple-800',
      delivered: 'bg-green-100 text-green-800',
      cancelled: 'bg-red-100 text-red-800',
    };
    return colors[status] || 'bg-gray-100 text-gray-800';
  };

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <button
          onClick={() => navigate('/dashboard/orders')}
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
          {subOrders.map((subOrder) => (
            <div key={subOrder.id} className="card">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="font-semibold text-lg flex items-center gap-2">
                    <Truck className="w-5 h-5 text-primary-600" />
                    {subOrder.hubs?.name || 'Unknown Hub'} → {subOrder.couriers?.name || 'Courier'}
                  </h3>
                  <p className="text-sm text-gray-600 mt-1">
                    {subOrder.hubs?.city || 'Unknown City'} • Shipping: ₦{formatCurrency(subOrder.real_shipping_cost)}
                  </p>
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(subOrder.status)}`}>
                  {subOrder.status}
                </span>
              </div>

              {/* ITEMS TO PACK SECTION - FIXED WITH PRICES */}
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
                              {item.quantity}x
                            </span>
                            {item.name}
                          </p>
                          <div className="text-xs text-gray-600 mt-1 space-y-1">
                            <p>SKU: {item.sku}</p>
                            <p>Weight: {item.weight}kg per unit</p>
                            {/* ✅ FIXED: Show price per unit */}
                            {item.price && (
                              <p className="text-blue-600 font-semibold">
                                ₦{item.price.toLocaleString()} per unit
                              </p>
                            )}
                          </div>
                        </div>
                        {/* ✅ FIXED: Show total price */}
                        <div className="text-right ml-4">
                          {item.price && (
                            <>
                              <p className="text-lg font-bold text-gray-900">
                                ₦{(item.price * item.quantity).toLocaleString()}
                              </p>
                              <p className="text-xs text-gray-600">Total</p>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  
                  {/* ✅ FIXED: Enhanced Summary with Prices */}
                  <div className="mt-3 pt-3 border-t border-green-200 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="font-semibold text-green-900">Total Items:</span>
                      <span className="font-bold text-green-900">
                        {subOrder.items.reduce((sum, item) => sum + item.quantity, 0)} pieces
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="font-semibold text-green-900">Total Weight:</span>
                      <span className="font-bold text-green-900">
                        {subOrder.items.reduce((sum, item) => sum + (item.weight * item.quantity), 0).toFixed(2)}kg
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="font-semibold text-green-900">Items Subtotal:</span>
                      <span className="font-bold text-lg text-green-900">
                        ₦{subOrder.items.reduce((sum, item) => sum + (item.price * item.quantity), 0).toLocaleString()}
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
                          subOrder.items.reduce((sum, item) => sum + (item.price * item.quantity), 0) + 
                          (subOrder.real_shipping_cost || 0)
                        ).toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Courier Integration Section */}
              {(subOrder.couriers?.api_enabled || subOrder.couriers?.code === 'fez') && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                  <div className="flex items-center gap-2 mb-3">
                    <CheckCircle className="w-4 h-4 text-blue-600" />
                    <span className="text-sm font-medium text-blue-900">
                      Courier API Integration Available ({subOrder.couriers?.name || 'Fez Delivery'})
                    </span>
                  </div>

                  {!subOrder.courier_shipment_id ? (
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
                          Send to {subOrder.couriers?.name || 'Fez Delivery'}
                        </>
                      )}
                    </button>
                  ) : (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <span className="text-gray-600">Courier Tracking:</span>
                          <p className="font-medium">{subOrder.tracking_number}</p>
                        </div>
                        <div>
                          <span className="text-gray-600">Shipment ID:</span>
                          <p className="font-medium text-xs">{subOrder.courier_shipment_id}</p>
                        </div>
                      </div>

                      <div className="flex gap-2">
                        {subOrder.courier_tracking_url && (
                          <a
                            href={subOrder.courier_tracking_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn-secondary text-sm flex items-center"
                          >
                            <ExternalLink className="w-4 h-4 mr-2" />
                            Track on Courier Site
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
                              Fetching...
                            </>
                          ) : (
                            <>
                              <Truck className="w-4 h-4 mr-2" />
                              Update Tracking
                            </>
                          )}
                        </button>

                        {subOrder.label_url && (
                          <button
                            onClick={() => downloadLabel(subOrder.label_url)}
                            className="btn-secondary text-sm flex items-center"
                          >
                            <Download className="w-4 h-4 mr-2" />
                            Download Label
                          </button>
                        )}
                      </div>

                      {subOrder.last_tracking_update && (
                        <p className="text-xs text-gray-500">
                          Last updated: {new Date(subOrder.last_tracking_update).toLocaleString()}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Manual Tracking (if API not enabled) */}
              {!(subOrder.couriers?.api_enabled || subOrder.couriers?.code === 'fez') && (
                <div className="bg-gray-50 rounded-lg p-4">
                  <p className="text-sm text-gray-600 mb-2">Manual Tracking Number:</p>
                  <p className="font-mono font-semibold text-lg">{subOrder.tracking_number || 'Not assigned'}</p>
                  <p className="text-xs text-gray-500 mt-2">
                    Enable API integration in Courier Settings for automatic shipment creation
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}