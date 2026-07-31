import { Phone } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Sheet } from './Sheet';
import { getOrderStatusLabel, getOrderStatusStyle, orderDisplayLabel, formatNaira } from './lib/orderDisplay';
import type { OrderCardOrder } from './OrderCard';

export interface OrderSheetOrder extends OrderCardOrder {
  customer_phone?: string | null;
  delivery_city?: string | null;
  delivery_state?: string | null;
}

interface OrderSheetProps {
  order: OrderSheetOrder | null;
  onClose: () => void;
}

// Shared by Home and Orders — same sheet, same fields, whichever screen a
// card is tapped from. Only shows a "Call customer" action when the order
// actually has a phone number (the /orders list endpoint returns every
// column, but not every order has one filled in).
export function OrderSheet({ order, onClose }: OrderSheetProps) {
  const navigate = useNavigate();
  const destination = order ? [order.delivery_city, order.delivery_state].filter(Boolean).join(', ') : '';

  return (
    <Sheet open={!!order} onClose={onClose} ariaLabel="Order actions">
      {order && (
        <>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-mono text-xs text-gray-500">#{orderDisplayLabel(order)}</div>
              <div className="mt-0.5 text-lg font-bold tracking-tight text-gray-900">{order.customer_name}</div>
            </div>
            <div className="whitespace-nowrap font-mono text-lg font-bold tabular-nums text-gray-900">
              {formatNaira(order.total_amount)}
            </div>
          </div>

          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="pt-0.5 font-mono text-[11px] uppercase tracking-wide text-gray-400">Status</dt>
            <dd>
              <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide ${getOrderStatusStyle(order.overall_status)}`}>
                {getOrderStatusLabel(order.overall_status)}
              </span>
            </dd>
            {destination && (
              <>
                <dt className="pt-0.5 font-mono text-[11px] uppercase tracking-wide text-gray-400">To</dt>
                <dd className="text-gray-900">{destination}</dd>
              </>
            )}
            {order.courier_label && (
              <>
                <dt className="pt-0.5 font-mono text-[11px] uppercase tracking-wide text-gray-400">Courier</dt>
                <dd className="text-gray-900">{order.courier_label}</dd>
              </>
            )}
          </dl>

          <div className="grid grid-cols-2 gap-2 pt-1">
            {order.customer_phone && (
              <a
                href={`tel:${order.customer_phone}`}
                className="flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 py-3 text-sm font-semibold text-gray-900"
              >
                <Phone className="h-4 w-4" />
                Call customer
              </a>
            )}
            <button
              type="button"
              onClick={() => {
                onClose();
                navigate(`/admin/orders/${order.id}`);
              }}
              className={`rounded-lg border border-gray-200 bg-gray-50 py-3 text-sm font-semibold text-gray-900 ${
                order.customer_phone ? '' : 'col-span-2'
              }`}
            >
              Open full record
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}
