import { useCallback, useEffect, useState, type ComponentType, type SVGProps } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Package,
  MapPin,
  Truck,
  CheckCircle,
  Clock,
  ArrowLeft,
  Phone,
  Home,
  AlertCircle,
  ExternalLink,
} from 'lucide-react';
import { BrandLogo } from '../../shared/BrandLogo';

const JLO_BASE = '';

interface TrackingEvent {
  status: string;
  location: string | null;
  description: string;
  timestamp: string;
}

interface ManualShipmentTrack {
  id: string;
  shipment_code: string;
  status: string;
  tracking_number: string | null;
  courier_tracking_url: string | null;
  waybill_number: string | null;
  sender: { name: string; address: string; city: string; state: string; phone?: string };
  recipient: { name: string; address: string; city: string; state: string; phone: string };
  item_description: string;
  item_weight: number;
  item_value: number;
  delivery_person_name: string | null;
  delivery_person_phone: string | null;
  last_tracking_update: string | null;
  created_at: string;
  couriers: { name: string; code: string } | null;
  tracking_events: TrackingEvent[];
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  assigned: 'Rider Assigned',
  pending_pickup: 'Awaiting Pickup',
  picked_up: 'Picked Up',
  in_transit: 'In Transit',
  out_for_delivery: 'Out for Delivery',
  delivered: 'Delivered',
  returned: 'Returned',
  cancelled: 'Cancelled',
};

export function ManualShipmentTrackingPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [shipment, setShipment] = useState<ManualShipmentTrack | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const trackingNumber = searchParams.get('tracking');
  const phone = searchParams.get('phone');

  const fetchShipment = useCallback(async () => {
    try {
      const qs = new URLSearchParams({
        trackingNumber: trackingNumber ?? '',
        phone: phone ?? '',
      });
      const res = await fetch(`${JLO_BASE}/.netlify/functions/track-manual-shipment?${qs}`);
      const data = await res.json();

      if (data.success) {
        setShipment(data.data);
      } else {
        setError(data.error || 'Shipment not found');
      }
    } catch {
      setError('Failed to fetch shipment information');
    } finally {
      setLoading(false);
    }
  }, [trackingNumber, phone]);

  useEffect(() => {
    if (trackingNumber && phone) {
      fetchShipment();
    } else {
      setError('Missing tracking number or phone');
      setLoading(false);
    }
  }, [trackingNumber, phone, fetchShipment]);

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      pending: 'bg-yellow-100 text-yellow-800 border-yellow-300',
      assigned: 'bg-blue-100 text-blue-800 border-blue-300',
      pending_pickup: 'bg-indigo-100 text-indigo-800 border-indigo-300',
      picked_up: 'bg-indigo-100 text-indigo-800 border-indigo-300',
      in_transit: 'bg-purple-100 text-purple-800 border-purple-300',
      out_for_delivery: 'bg-orange-100 text-orange-800 border-orange-300',
      delivered: 'bg-green-100 text-green-800 border-green-300',
      cancelled: 'bg-red-100 text-red-800 border-red-300',
      returned: 'bg-gray-100 text-gray-800 border-gray-300',
    };
    return colors[status] || 'bg-gray-100 text-gray-800 border-gray-300';
  };

  const getStatusIcon = (status: string) => {
    const icons: Record<string, ComponentType<SVGProps<SVGSVGElement>>> = {
      pending: Clock,
      assigned: Package,
      pending_pickup: Clock,
      picked_up: Package,
      in_transit: Truck,
      out_for_delivery: Truck,
      delivered: CheckCircle,
      cancelled: AlertCircle,
      returned: AlertCircle,
    };
    const Icon = icons[status] || Clock;
    return <Icon className="w-5 h-5" />;
  };

  const getCourierTrackingUrl = (): string | null => {
    if (!shipment?.tracking_number) return null;
    if (shipment.courier_tracking_url) return shipment.courier_tracking_url;
    const code = shipment.couriers?.code?.toLowerCase();
    if (code === 'fez' || code === 'fez_delivery' || shipment.tracking_number) {
      return `https://web.fezdelivery.co/track-delivery?tracking=${shipment.tracking_number}`;
    }
    return null;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mb-4" />
          <p className="text-gray-600">Loading your shipment...</p>
        </div>
      </div>
    );
  }

  if (error || !shipment) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-red-100 rounded-full mb-4">
            <AlertCircle className="w-8 h-8 text-red-600" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Shipment Not Found</h2>
          <p className="text-gray-600 mb-6">{error || 'We could not find a shipment matching that information.'}</p>
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

  const trackingUrl = getCourierTrackingUrl();
  const events = shipment.tracking_events || [];

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <BrandLogo withText size={28} textClassName="text-2xl font-bold text-primary-600" />
            <button
              onClick={() => navigate('/')}
              className="text-gray-600 hover:text-primary-600 flex items-center gap-2"
            >
              <ArrowLeft className="w-5 h-5" />
              Track Another
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <div className="flex items-start justify-between mb-4 gap-4">
            <div>
              <h2 className="text-3xl font-bold text-gray-900 mb-2">{shipment.shipment_code}</h2>
              <p className="text-gray-600">
                Created{' '}
                {new Date(shipment.created_at).toLocaleDateString('en-US', {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </p>
            </div>
            <span
              className={`px-4 py-2 rounded-full text-sm font-medium border-2 flex items-center gap-2 shrink-0 ${getStatusColor(shipment.status)}`}
            >
              {getStatusIcon(shipment.status)}
              {(STATUS_LABELS[shipment.status] || shipment.status.replace(/_/g, ' ')).toUpperCase()}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-6 border-t">
            <div>
              <h3 className="text-sm font-medium text-gray-500 mb-2 flex items-center gap-2">
                <Home className="w-4 h-4" />
                Delivery To
              </h3>
              <p className="font-semibold text-gray-900">{shipment.recipient.name}</p>
              <p className="text-sm text-gray-600">{shipment.recipient.address}</p>
              <p className="text-sm text-gray-600">
                {shipment.recipient.city}, {shipment.recipient.state}
              </p>
              <p className="text-sm text-gray-600 flex items-center gap-1 mt-1">
                <Phone className="w-3 h-3" />
                {shipment.recipient.phone}
              </p>
            </div>
            <div>
              <h3 className="text-sm font-medium text-gray-500 mb-2 flex items-center gap-2">
                <Package className="w-4 h-4" />
                Package
              </h3>
              <p className="text-gray-900">{shipment.item_description}</p>
              <p className="text-sm text-gray-600 mt-1">
                {shipment.item_weight}kg
                {shipment.couriers?.name ? ` · ${shipment.couriers.name}` : ''}
              </p>
              {shipment.delivery_person_name && (
                <p className="text-sm text-gray-600 mt-2">
                  Rider: {shipment.delivery_person_name}
                  {shipment.delivery_person_phone ? ` (${shipment.delivery_person_phone})` : ''}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="bg-gray-50 rounded-lg p-4 mb-6">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <p className="text-sm text-gray-600 mb-1">Tracking Number</p>
                <p className="text-xl font-mono font-bold text-gray-900">
                  {shipment.tracking_number || 'Not assigned yet'}
                </p>
              </div>
              {trackingUrl && (
                <a
                  href={trackingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-secondary text-sm flex items-center gap-2"
                >
                  Track on Courier Site
                  <ExternalLink className="w-4 h-4" />
                </a>
              )}
            </div>
            {shipment.last_tracking_update && (
              <p className="text-sm text-gray-500 mt-2">
                Last updated: {new Date(shipment.last_tracking_update).toLocaleString()}
              </p>
            )}
          </div>

          {events.length > 0 ? (
            <div className="relative">
              <h5 className="font-semibold text-gray-900 mb-4">Tracking Updates</h5>
              <div className="space-y-4">
                {[...events].reverse().map((event, eventIndex) => {
                  const isLatest = eventIndex === 0;
                  return (
                    <div key={eventIndex} className="flex gap-4">
                      <div className="flex flex-col items-center">
                        <div className={`w-3 h-3 rounded-full ${isLatest ? 'bg-primary-600' : 'bg-gray-300'}`} />
                        {eventIndex !== events.length - 1 && <div className="w-0.5 h-full bg-gray-200 my-1" />}
                      </div>
                      <div className="flex-1 pb-4">
                        <div className="flex items-start justify-between mb-1 gap-2">
                          <h6 className={`font-semibold ${isLatest ? 'text-primary-600' : 'text-gray-900'}`}>
                            {STATUS_LABELS[event.status] || event.status.replace(/_/g, ' ')}
                          </h6>
                          <span className="text-xs text-gray-400 shrink-0">
                            {new Date(event.timestamp).toLocaleString('en-GB', {
                              day: 'numeric',
                              month: 'short',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                        {event.description && <p className="text-sm text-gray-600">{event.description}</p>}
                        {event.location && (
                          <p className="text-sm text-gray-500 flex items-center gap-1 mt-1">
                            <MapPin className="w-3 h-3" />
                            {event.location}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">
              <Clock className="w-12 h-12 mx-auto mb-2 text-gray-400" />
              <p>Tracking updates will appear here once your shipment is in transit</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
