const JLO_BASE = '';

export interface TrackingEvent {
  status: string;
  location: string;
  description: string;
  timestamp: string;
  created_at: string;
}

export interface SubOrder {
  id: string;
  tracking_number: string;
  status: string;
  shipping_cost: number;
  estimated_delivery_date: string;
  courier_tracking_url: string;
  created_at: string;
  hubs: { name: string; city: string; state: string };
  couriers: { name: string; code: string };
  tracking_events: TrackingEvent[];
}

export interface ReturnShipment {
  id: string;
  return_code?: string;
  fez_tracking?: string | null;
  method: 'pickup' | 'dropoff';
  status?: string;
  created_at?: string;
}

export interface Order {
  id: string;
  order_number?: number | string;
  woocommerce_order_id?: string | null;
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
  return_shipments?: ReturnShipment[];
}

const SUB_STATUS_PRIORITY: Record<string, number> = {
  pending: 1,
  vendor_dispatched: 2,
  assigned: 3,
  pending_pickup: 3,
  picked_up: 4,
  in_transit: 5,
  out_for_delivery: 6,
  delivered: 7,
  returned: 8,
  failed: 9,
  cancelled: 10,
};

export function deriveDisplayStatus(order: Order): string {
  const subOrders = order.sub_orders || [];
  if (!subOrders.length) return order.overall_status;
  return subOrders.reduce((best, so) => {
    const curr = SUB_STATUS_PRIORITY[so.status] ?? 0;
    const bestP = SUB_STATUS_PRIORITY[best] ?? 0;
    return curr > bestP ? so.status : best;
  }, 'pending');
}

export function statusPillClass(status: string): string {
  const colors: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-800',
    processing: 'bg-blue-100 text-blue-800',
    assigned: 'bg-blue-100 text-blue-800',
    pending_pickup: 'bg-indigo-100 text-indigo-800',
    picked_up: 'bg-indigo-100 text-indigo-800',
    in_transit: 'bg-purple-100 text-purple-800',
    out_for_delivery: 'bg-orange-100 text-orange-800',
    delivered: 'bg-green-100 text-green-800',
    cancelled: 'bg-red-100 text-red-800',
    returned: 'bg-gray-100 text-gray-800',
  };
  return colors[status] ?? 'bg-gray-100 text-gray-800';
}

export function getCourierTrackingUrl(subOrder: SubOrder): string | null {
  if (!subOrder.tracking_number) return null;

  const courierCode = subOrder.couriers?.code?.toLowerCase();
  if (courierCode === 'fez' || courierCode === 'fez_delivery') {
    return `https://web.fezdelivery.co/track-delivery?tracking=${subOrder.tracking_number}`;
  }
  if (courierCode === 'gigl') {
    return `https://giglogistics.com/track?tracking=${subOrder.tracking_number}`;
  }
  if (courierCode === 'kwik') {
    return `https://kwik.delivery/track/${subOrder.tracking_number}`;
  }
  return subOrder.courier_tracking_url || null;
}

export function getReturnTrackingUrl(shipment: ReturnShipment): string | null {
  if (!shipment.fez_tracking) return null;
  return `https://web.fezdelivery.co/track-delivery?tracking=${shipment.fez_tracking}`;
}

export async function fetchTrackedOrder(orderNumber: string, email: string): Promise<Order> {
  const qs = new URLSearchParams({ orderNumber, email });
  const res = await fetch(`${JLO_BASE}/.netlify/functions/track-order?${qs}`);
  const data = await res.json();
  if (!data.success) {
    throw new Error(data.error || 'Order not found');
  }
  return data.data;
}

export function formatNaira(value?: number | null): string {
  const amount = typeof value === 'number' ? value : 0;
  return amount.toLocaleString('en-NG');
}
