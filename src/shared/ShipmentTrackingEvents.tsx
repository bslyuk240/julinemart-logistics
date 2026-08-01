import { Clock, MapPin } from 'lucide-react';

export interface ShipmentTrackingEvent {
  status: string;
  description?: string | null;
  location?: string | null;
  timestamp: string;
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  assigned: 'Rider assigned',
  pending_pickup: 'Awaiting pickup',
  picked_up: 'Picked up',
  in_transit: 'In transit',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  returned: 'Returned',
  cancelled: 'Cancelled',
  vendor_dispatched: 'Sent to hub',
};

function formatEventTime(iso: string): string {
  return new Date(iso).toLocaleString('en-NG', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusLabel(status: string): string {
  return STATUS_LABELS[status] || status.replace(/_/g, ' ');
}

interface ShipmentTrackingEventsProps {
  events: ShipmentTrackingEvent[];
  title?: string;
  emptyMessage?: string;
  className?: string;
}

export function ShipmentTrackingEvents({
  events,
  title = 'Tracking updates',
  emptyMessage = 'Updates will appear here once your shipment is on the move.',
  className = '',
}: ShipmentTrackingEventsProps) {
  const sorted = [...events].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  if (sorted.length === 0) {
    return (
      <div className={`rounded-2xl bg-white p-6 text-center ${className}`}>
        <Clock className="mx-auto mb-3 h-10 w-10 text-gray-300" />
        <p className="text-sm font-medium text-gray-700">{title}</p>
        <p className="mt-1 text-sm text-gray-500">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className={`rounded-2xl bg-white p-4 ${className}`}>
      <h3 className="mb-4 text-sm font-semibold text-gray-900">{title}</h3>
      <div className="space-y-0">
        {sorted.map((event, index) => {
          const isLatest = index === 0;
          const isLast = index === sorted.length - 1;
          return (
            <div key={`${event.timestamp}-${index}`} className="flex gap-3">
              <div className="flex flex-col items-center pt-1">
                <div
                  className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                    isLatest ? 'bg-primary-600 ring-4 ring-primary-100' : 'bg-gray-300'
                  }`}
                />
                {!isLast && <div className="my-1 w-0.5 flex-1 min-h-[2rem] bg-gray-200" />}
              </div>
              <div className={`min-w-0 flex-1 ${isLast ? 'pb-0' : 'pb-5'}`}>
                <div className="flex items-start justify-between gap-2">
                  <p className={`text-sm font-semibold capitalize ${isLatest ? 'text-primary-700' : 'text-gray-900'}`}>
                    {statusLabel(event.status)}
                  </p>
                  <time className="shrink-0 text-[11px] text-gray-400">{formatEventTime(event.timestamp)}</time>
                </div>
                {event.description && (
                  <p className="mt-0.5 text-sm text-gray-600">{event.description}</p>
                )}
                {event.location && (
                  <p className="mt-1 flex items-center gap-1 text-xs text-gray-500">
                    <MapPin className="h-3 w-3 shrink-0" />
                    {event.location}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
