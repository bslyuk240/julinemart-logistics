import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { 
  Package, MapPin, Truck, CheckCircle, Clock, 
  ArrowLeft, Phone, Mail, Home, AlertCircle, ExternalLink
} from 'lucide-react';
import { BrandLogo } from '../../shared/BrandLogo';

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
  sub_orders: SubOrder[];
}

interface SubOrder {
  id: string;
  tracking_number: string;
  status: string;
  shipping_cost: number;
  estimated_delivery_date: string;
  courier_tracking_url: string;
  created_at: string;
  hubs: {
    name: string;
    city: string;
    state: string;
  };
  couriers: {
    name: string;
    code: string;
  };
  tracking_events: TrackingEvent[];
}

interface TrackingEvent {
  status: string;
  location: string;
  description: string;
  timestamp: string;
  created_at: string;
}

export function OrderTrackingPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { id: routeOrderId } = useParams<{ id?: string }>();
  const searchParamsString = searchParams.toString();
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || '/api';

  const formatCurrency = (value?: number | null) => {
    const amount = typeof value === 'number' ? value : 0;
    return amount.toLocaleString();
  };

  const orderNumber = searchParams.get('order');
  const email = searchParams.get('email');
 
  useEffect(() => {
    if (routeOrderId && !orderNumber) {
      const params = new URLSearchParams(searchParams);
      params.set('order', routeOrderId);
      setSearchParams(params, { replace: true });
    }
  }, [routeOrderId, orderNumber, searchParamsString, setSearchParams]);

  useEffect(() => {
    if (orderNumber && email) {
      fetchOrder();
    } else {
      setError('Missing order number or email');
      setLoading(false);
    }
  }, [orderNumber, email]);

  const fetchOrder = async () => {
    try {
      const response = await fetch(
        `${apiBaseUrl}/track-order?orderNumber=${orderNumber}&email=${email}`
      );
      const data = await response.json();

      if (data.success) {
        setOrder(data.data);
      } else {
        setError(data.error || 'Order not found');
      }
    } catch (err) {
      setError('Failed to fetch order information');
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      pending: 'bg-yellow-100 text-yellow-800 border-yellow-300',
      processing: 'bg-blue-100 text-blue-800 border-blue-300',
      in_transit: 'bg-purple-100 text-purple-800 border-purple-300',
      delivered: 'bg-green-100 text-green-800 border-green-300',
      cancelled: 'bg-red-100 text-red-800 border-red-300',
    };
    return colors[status] || 'bg-gray-100 text-gray-800 border-gray-300';
  };

  const getStatusIcon = (status: string) => {
    const icons: Record<string, any> = {
      pending: Clock,
      processing: Package,
      in_transit: Truck,
      delivered: CheckCircle,
      cancelled: AlertCircle,
    };
    const Icon = icons[status] || Clock;
    return <Icon className="w-5 h-5" />;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mb-4"></div>
          <p className="text-gray-600">Loading your order...</p>
        </div>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-red-100 rounded-full mb-4">
            <AlertCircle className="w-8 h-8 text-red-600" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Order Not Found</h2>
          <p className="text-gray-600 mb-6">
            {error || 'We couldn\'t find an order matching that information.'}
          </p>
          <button
            onClick={() => navigate('/')}
            className="btn-primary flex items-center justify-center mx-auto"
          >
            <ArrowLeft className="w-5 h-5 mr-2" />
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <BrandLogo withText size={28} textClassName="text-2xl font-bold text-primary-600" />
            <button
              onClick={() => navigate('/')}
              className="text-gray-600 hover:text-primary-600 flex items-center gap-2"
            >
              <ArrowLeft className="w-5 h-5" />
              Track Another Order
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Order Header */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-3xl font-bold text-gray-900 mb-2">
                Order #{order.woocommerce_order_id}
              </h2>
              <p className="text-gray-600">
                Placed on {new Date(order.created_at).toLocaleDateString('en-US', {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </p>
            </div>
            <span className={`px-4 py-2 rounded-full text-sm font-medium border-2 flex items-center gap-2 ${getStatusColor(order.overall_status)}`}>
              {getStatusIcon(order.overall_status)}
              {order.overall_status.replace('_', ' ').toUpperCase()}
            </span>
          </div>

          {/* Customer & Delivery Info Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-6 pt-6 border-t">
            <div>
              <h3 className="text-sm font-medium text-gray-500 mb-2 flex items-center gap-2">
                <Package className="w-4 h-4" />
                Customer Information
              </h3>
              <p className="font-semibold text-gray-900">{order.customer_name}</p>
              <p className="text-sm text-gray-600 flex items-center gap-1 mt-1">
                <Mail className="w-3 h-3" />
                {order.customer_email}
              </p>
              <p className="text-sm text-gray-600 flex items-center gap-1 mt-1">
                <Phone className="w-3 h-3" />
                {order.customer_phone}
              </p>
            </div>

            <div>
              <h3 className="text-sm font-medium text-gray-500 mb-2 flex items-center gap-2">
                <Home className="w-4 h-4" />
                Delivery Address
              </h3>
              <p className="text-gray-900">{order.delivery_address}</p>
              <p className="text-gray-600">{order.delivery_city}, {order.delivery_state}</p>
            </div>

            <div>
              <h3 className="text-sm font-medium text-gray-500 mb-2">Order Summary</h3>
              <div className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Subtotal:</span>
                  <span className="font-medium">₦{formatCurrency((order.total_amount ?? 0) - (order.shipping_fee_paid ?? 0))}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Shipping:</span>
                  <span className="font-medium">₦{formatCurrency(order.shipping_fee_paid)}</span>
                </div>
                <div className="flex justify-between text-lg font-bold pt-2 border-t">
                  <span>Total:</span>
                  <span className="text-primary-600">₦{formatCurrency(order.total_amount)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Shipments */}
        <div className="space-y-6">
          <h3 className="text-2xl font-bold text-gray-900">
            Shipment Tracking ({order.sub_orders.length})
          </h3>

          {order.sub_orders.map((subOrder, index) => (
            <div key={subOrder.id} className="bg-white rounded-lg shadow-md p-6">
              {/* Shipment Header */}
              <div className="flex items-start justify-between mb-6">
                <div>
                  <h4 className="text-xl font-bold text-gray-900 mb-2">
                    Shipment {index + 1} - {subOrder.hubs.name}
                  </h4>
                  <div className="flex items-center gap-4 text-sm text-gray-600">
                    <span className="flex items-center gap-1">
                      <MapPin className="w-4 h-4" />
                      From: {subOrder.hubs.city}, {subOrder.hubs.state}
                    </span>
                    <span className="flex items-center gap-1">
                      <Truck className="w-4 h-4" />
                      Courier: {subOrder.couriers.name}
                    </span>
                  </div>
                </div>
                <span className={`px-3 py-1 rounded-full text-sm font-medium border-2 ${getStatusColor(subOrder.status)}`}>
                  {subOrder.status.replace('_', ' ').toUpperCase()}
                </span>
              </div>

              {/* Tracking Number */}
              <div className="bg-gray-50 rounded-lg p-4 mb-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600 mb-1">Tracking Number</p>
                    <p className="text-xl font-mono font-bold text-gray-900">{subOrder.tracking_number}</p>
                  </div>
                  {subOrder.courier_tracking_url && (
                    <a
                      href={subOrder.courier_tracking_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-secondary text-sm flex items-center gap-2"
                    >
                      Track on Courier Site
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  )}
                </div>
                {subOrder.estimated_delivery_date && (
                  <p className="text-sm text-gray-600 mt-2">
                    Estimated Delivery: {new Date(subOrder.estimated_delivery_date).toLocaleDateString()}
                  </p>
                )}
              </div>

              {/* Tracking Timeline */}
              {subOrder.tracking_events && subOrder.tracking_events.length > 0 ? (
                <div className="relative">
                  <h5 className="font-semibold text-gray-900 mb-4">Tracking Updates</h5>
                  <div className="space-y-4">
                    {subOrder.tracking_events.map((event: TrackingEvent, eventIndex: number) => (
                      <div key={eventIndex} className="flex gap-4">
                        {/* Timeline Line */}
                        <div className="flex flex-col items-center">
                          <div className={`w-3 h-3 rounded-full ${
                            eventIndex === 0 ? 'bg-primary-600' : 'bg-gray-300'
                          }`} />
                          {eventIndex !== subOrder.tracking_events.length - 1 && (
                            <div className="w-0.5 h-full bg-gray-300 my-1" />
                          )}
                        </div>

                        {/* Event Details */}
                        <div className="flex-1 pb-4">
                          <div className="flex items-start justify-between mb-1">
                            <h6 className="font-semibold text-gray-900">{event.status}</h6>
                            <span className="text-sm text-gray-500">
                              {new Date(event.timestamp).toLocaleString()}
                            </span>
                          </div>
                          <p className="text-sm text-gray-600">{event.description}</p>
                          {event.location && (
                            <p className="text-sm text-gray-500 flex items-center gap-1 mt-1">
                              <MapPin className="w-3 h-3" />
                              {event.location}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <Clock className="w-12 h-12 mx-auto mb-2 text-gray-400" />
                  <p>Tracking updates will appear here once your shipment is in transit</p>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Help Section */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mt-8">
          <h3 className="font-semibold text-blue-900 mb-2">Need Help?</h3>
          <p className="text-blue-800 text-sm mb-4">
            If you have questions about your order or need assistance, our support team is here to help.
          </p>
          <div className="flex flex-wrap gap-4">
            <a
              href="mailto:support@julinemart.com"
              className="btn-secondary text-sm flex items-center gap-2"
            >
              <Mail className="w-4 h-4" />
              Email Support
            </a>
            <a
              href="tel:+2348000000000"
              className="btn-secondary text-sm flex items-center gap-2"
            >
              <Phone className="w-4 h-4" />
              Call Us
            </a>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="bg-gray-900 text-white py-8 mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <p className="text-gray-400">&copy; 2025 JulineMart. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
