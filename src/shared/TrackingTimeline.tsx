import { AlertTriangle } from 'lucide-react';

export type TrackingTimelineVariant =
  | 'sub_order_fez'
  | 'sub_order_local'
  | 'manual_fez'
  | 'manual_local';

const STEP_SETS: Record<TrackingTimelineVariant, Array<{ key: string; label: string }>> = {
  sub_order_fez: [
    { key: 'pending', label: 'Pending' },
    { key: 'vendor_dispatched', label: 'Sent to Hub' },
    { key: 'assigned', label: 'Assigned' },
    { key: 'pending_pickup', label: 'Pending\nPick-Up' },
    { key: 'picked_up', label: 'Picked Up' },
    { key: 'in_transit', label: 'In Transit' },
    { key: 'out_for_delivery', label: 'Out for Delivery' },
    { key: 'delivered', label: 'Delivered' },
  ],
  sub_order_local: [
    { key: 'pending', label: 'Pending' },
    { key: 'vendor_dispatched', label: 'Sent to Hub' },
    { key: 'assigned', label: 'Assigned' },
    { key: 'picked_up', label: 'Picked Up' },
    { key: 'out_for_delivery', label: 'Out for Delivery' },
    { key: 'delivered', label: 'Delivered' },
  ],
  manual_fez: [
    { key: 'pending', label: 'Pending' },
    { key: 'assigned', label: 'Assigned' },
    { key: 'pending_pickup', label: 'Pending\nPick-Up' },
    { key: 'picked_up', label: 'Picked Up' },
    { key: 'in_transit', label: 'In Transit' },
    { key: 'out_for_delivery', label: 'Out for Delivery' },
    { key: 'delivered', label: 'Delivered' },
  ],
  manual_local: [
    { key: 'pending', label: 'Pending' },
    { key: 'assigned', label: 'Assigned' },
    { key: 'picked_up', label: 'Picked Up' },
    { key: 'out_for_delivery', label: 'Out for Delivery' },
    { key: 'delivered', label: 'Delivered' },
  ],
};

function normalizeStatus(status: string): string {
  const statusMap: Record<string, string> = {
    pending: 'pending',
    vendor_dispatched: 'vendor_dispatched',
    pending_pickup: 'pending_pickup',
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
  return statusMap[status.toLowerCase()] || 'pending';
}

function resolveStepIndex(steps: Array<{ key: string }>, status: string): number {
  const normalized = normalizeStatus(status);
  const direct = steps.findIndex((step) => step.key === normalized);
  if (direct >= 0) return direct;

  const rank: Record<string, number> = {
    pending: 0,
    vendor_dispatched: 1,
    assigned: 2,
    pending_pickup: 3,
    picked_up: 4,
    in_transit: 5,
    out_for_delivery: 6,
    delivered: 7,
  };
  const target = rank[normalized] ?? 0;
  let best = 0;
  steps.forEach((step, index) => {
    if ((rank[step.key] ?? 0) <= target && index > best) best = index;
  });
  return best;
}

export function trackingVariantForShipment(input: {
  isManual?: boolean;
  isLocalRider?: boolean;
}): TrackingTimelineVariant {
  if (input.isManual) return input.isLocalRider ? 'manual_local' : 'manual_fez';
  return input.isLocalRider ? 'sub_order_local' : 'sub_order_fez';
}

interface TrackingTimelineProps {
  status: string;
  variant: TrackingTimelineVariant;
  layout?: 'desktop' | 'compact';
  className?: string;
}

export function TrackingTimeline({
  status,
  variant,
  layout = 'desktop',
  className = '',
}: TrackingTimelineProps) {
  const steps = STEP_SETS[variant];
  const currentStatus = normalizeStatus(status);
  const currentIndex = resolveStepIndex(steps, status);

  if (['cancelled', 'returned', 'failed'].includes(currentStatus)) {
    return (
      <div className={`p-3 bg-red-50 border border-red-200 rounded-lg ${className}`}>
        <div className="flex items-center gap-2 text-red-700">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span className="font-medium capitalize">{status.replace(/_/g, ' ')}</span>
        </div>
      </div>
    );
  }

  if (layout === 'compact') {
    return (
      <div className={className}>
        <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400 mb-2">Tracking progress</p>
        <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pt-1">
          {steps.map((step, index) => (
            <div key={step.key} className="flex shrink-0 flex-col items-center gap-1" style={{ width: 64 }}>
              <div className={`h-2 w-2 rounded-full ${index <= currentIndex ? 'bg-primary-600' : 'bg-gray-200'}`} />
              <span
                className={`text-center text-[9px] leading-tight ${
                  index <= currentIndex ? 'font-semibold text-gray-900' : 'text-gray-400'
                } ${index === currentIndex ? 'text-primary-700' : ''}`}
              >
                {step.label.replace('\n', ' ')}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={`mt-4 pt-4 border-t border-blue-200 ${className}`}>
      <p className="text-xs text-blue-700 mb-3 font-medium">Tracking Progress</p>
      <div className="flex items-center justify-between">
        {steps.map((step, index) => {
          const isCompleted = index <= currentIndex;
          const isCurrent = index === currentIndex;

          return (
            <div key={step.key} className="flex items-center flex-1">
              <div className="flex flex-col items-center">
                <div
                  className={`
                    w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold
                    transition-all duration-300
                    ${isCompleted ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-400'}
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
              {index < steps.length - 1 && (
                <div className={`flex-1 h-0.5 mx-1 ${index < currentIndex ? 'bg-green-500' : 'bg-gray-200'}`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
