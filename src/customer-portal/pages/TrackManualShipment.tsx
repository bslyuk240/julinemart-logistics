import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Copy,
  ExternalLink,
  Loader,
  MapPin,
  Package,
  Phone,
  RefreshCw,
  Truck,
} from 'lucide-react';
import { ShipmentTrackingEvents } from '../../shared/ShipmentTrackingEvents';

const JLO_BASE = '';

interface ManualShipmentTrack {
  id: string;
  shipment_code: string;
  status: string;
  tracking_number: string | null;
  courier_tracking_url: string | null;
  waybill_number: string | null;
  sender: { name: string; city: string; state: string };
  recipient: { name: string; address: string; city: string; state: string; phone: string };
  item_description: string;
  item_weight: number;
  delivery_person_name: string | null;
  delivery_person_phone: string | null;
  last_tracking_update: string | null;
  created_at: string;
  couriers: { name: string; code: string } | null;
  tracking_events: Array<{
    status: string;
    description: string;
    location: string | null;
    timestamp: string;
  }>;
}

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  assigned: 'bg-blue-100 text-blue-800',
  pending_pickup: 'bg-indigo-100 text-indigo-800',
  picked_up: 'bg-indigo-100 text-indigo-800',
  in_transit: 'bg-purple-100 text-purple-800',
  out_for_delivery: 'bg-orange-100 text-orange-800',
  delivered: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
  returned: 'bg-gray-100 text-gray-800',
};

function statusPillClass(status: string): string {
  return STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-800';
}

function statusPillLabel(status: string): string {
  return status.replace(/_/g, ' ');
}

export function ManualShipmentTrackingPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [shipment, setShipment] = useState<ManualShipmentTrack | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const trackingNumber = searchParams.get('tracking');
  const phone = searchParams.get('phone');

  const fetchShipment = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError('');

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
        setShipment(null);
        setError(data.error || 'Shipment not found');
      }
    } catch {
      setShipment(null);
      setError('Failed to fetch shipment information');
    } finally {
      setLoading(false);
      setRefreshing(false);
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

  const copyTracking = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable
    }
  };

  const courierTrackUrl =
    shipment?.courier_tracking_url ||
    (shipment?.tracking_number
      ? `https://web.fezdelivery.co/track-delivery?tracking=${encodeURIComponent(shipment.tracking_number)}`
      : null);

  if (loading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-gray-50">
        <div className="text-center">
          <Loader className="mx-auto mb-3 h-8 w-8 animate-spin text-primary-600" />
          <p className="text-sm text-gray-600">Loading shipment…</p>
        </div>
      </div>
    );
  }

  if (error || !shipment) {
    return (
      <div className="flex min-h-[100dvh] flex-col bg-gray-50">
        <header className="sticky top-0 z-10 border-b border-gray-100 bg-white px-4 py-3">
          <button type="button" onClick={() => navigate('/')} className="flex items-center gap-2 text-sm text-gray-600">
            <ArrowLeft className="h-5 w-5" />
            Back
          </button>
        </header>
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-sm">
            <p className="text-lg font-semibold text-gray-900">Shipment not found</p>
            <p className="mt-2 text-sm text-gray-600">{error || 'Check your tracking number and phone.'}</p>
            <button
              type="button"
              onClick={() => navigate('/')}
              className="mt-5 w-full rounded-xl bg-primary-600 py-3.5 text-sm font-semibold text-white"
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  const events = shipment.tracking_events || [];

  return (
    <div className="flex min-h-[100dvh] flex-col bg-gray-50">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-gray-100 bg-white/95 px-4 py-3 backdrop-blur">
        <button type="button" onClick={() => navigate('/')} aria-label="Back" className="shrink-0 text-gray-500">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-gray-900">{shipment.shipment_code}</p>
          <p className="truncate text-[11px] text-gray-400">Manual shipment</p>
        </div>
        <button
          type="button"
          onClick={() => fetchShipment(true)}
          disabled={refreshing}
          aria-label="Refresh tracking"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-gray-200 text-gray-600 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </header>

      <main className="flex-1 pb-8">
        <section className="border-b border-gray-100 bg-white px-4 py-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase ${statusPillClass(shipment.status)}`}>
              {statusPillLabel(shipment.status)}
            </span>
            {shipment.couriers?.name && (
              <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-medium text-gray-600">
                {shipment.couriers.name}
              </span>
            )}
          </div>
          <p className="mt-3 text-xl font-bold text-gray-900">{shipment.recipient.name}</p>
          <p className="mt-1 text-sm text-gray-600">{shipment.recipient.address}</p>
          <p className="text-sm text-gray-500">
            {shipment.recipient.city}, {shipment.recipient.state}
          </p>
          <div className="mt-4 flex items-center gap-2 text-xs text-gray-500">
            <span className="rounded-full bg-gray-100 px-2 py-1 font-medium">{shipment.sender.city || 'Origin'}</span>
            <ArrowRight className="h-3 w-3 text-gray-300" />
            <span className="rounded-full bg-primary-50 px-2 py-1 font-medium text-primary-700">{shipment.recipient.city}</span>
          </div>
        </section>

        <section className="mx-4 mt-4 rounded-2xl bg-white p-4 shadow-sm">
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Tracking number</p>
          <div className="mt-1 flex items-center justify-between gap-3">
            <p className="font-mono text-lg font-bold text-gray-900 break-all">
              {shipment.tracking_number || 'Not assigned yet'}
            </p>
            {shipment.tracking_number && (
              <button
                type="button"
                onClick={() => copyTracking(shipment.tracking_number!)}
                aria-label="Copy tracking number"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-gray-200 text-gray-500"
              >
                <Copy className="h-4 w-4" />
              </button>
            )}
          </div>
          {copied && <p className="mt-1 text-xs text-green-600">Copied</p>}
          {shipment.last_tracking_update && (
            <p className="mt-2 text-xs text-gray-400">
              Last updated {new Date(shipment.last_tracking_update).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })}
            </p>
          )}
          {courierTrackUrl && (
            <a
              href={courierTrackUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-primary-200 bg-primary-50 py-3.5 text-sm font-semibold text-primary-700"
            >
              <ExternalLink className="h-4 w-4" />
              Track on courier site
            </a>
          )}
        </section>

        <section className="mx-4 mt-4">
          <ShipmentTrackingEvents
            events={events}
            title="Tracking updates"
            emptyMessage="Your shipment is booked. Updates will show here as the courier moves the package."
          />
        </section>

        <section className="mx-4 mt-4 space-y-3">
          <div className="rounded-2xl bg-white p-4 shadow-sm">
            <div className="flex gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-orange-50">
                <Package className="h-4 w-4 text-orange-600" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Package</p>
                <p className="mt-0.5 text-sm font-medium text-gray-900">{shipment.item_description}</p>
                <p className="mt-0.5 text-xs text-gray-500">{shipment.item_weight} kg</p>
              </div>
            </div>
          </div>

          {shipment.delivery_person_name && (
            <div className="rounded-2xl bg-white p-4 shadow-sm">
              <div className="flex gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-50">
                  <Truck className="h-4 w-4 text-blue-600" />
                </div>
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Rider</p>
                  <p className="mt-0.5 text-sm font-medium text-gray-900">{shipment.delivery_person_name}</p>
                  {shipment.delivery_person_phone && (
                    <a href={`tel:${shipment.delivery_person_phone}`} className="mt-1 flex items-center gap-1 text-sm text-primary-600">
                      <Phone className="h-3.5 w-3.5" />
                      {shipment.delivery_person_phone}
                    </a>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="rounded-2xl bg-white p-4 shadow-sm">
            <div className="flex gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100">
                <MapPin className="h-4 w-4 text-gray-600" />
              </div>
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Delivery phone</p>
                <p className="mt-0.5 text-sm text-gray-900">{shipment.recipient.phone}</p>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
