import { getOrderStatusLabel, getOrderStatusStyle, orderDisplayLabel, formatNaira, type OrderLike } from './lib/orderDisplay';

export interface OrderCardOrder extends OrderLike {
  customer_name: string;
  total_amount: number;
  overall_status: string;
  created_at: string;
  courier_label?: string | null;
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

interface OrderCardProps {
  order: OrderCardOrder;
  onTap: (order: OrderCardOrder) => void;
  selected?: boolean;
}

export function OrderCard({ order, onTap, selected = false }: OrderCardProps) {
  return (
    <button
      type="button"
      onClick={() => onTap(order)}
      className={`flex w-full flex-col gap-2 rounded-lg border p-3 text-left active:scale-[0.985] ${
        selected ? 'border-primary-300 bg-primary-50' : 'border-gray-200 bg-white'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[13px] font-bold tracking-tight text-gray-900">#{orderDisplayLabel(order)}</div>
          <div className="mt-0.5 text-sm font-medium text-gray-900">{order.customer_name}</div>
        </div>
        <div className="whitespace-nowrap text-sm font-bold tabular-nums text-gray-900">{formatNaira(order.total_amount)}</div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${getOrderStatusStyle(order.overall_status)}`}
        >
          {getOrderStatusLabel(order.overall_status)}
        </span>
        <span className="text-[10px] uppercase tracking-wide text-gray-400">
          {[order.courier_label, relativeTime(order.created_at)].filter(Boolean).join(' · ')}
        </span>
      </div>
    </button>
  );
}
