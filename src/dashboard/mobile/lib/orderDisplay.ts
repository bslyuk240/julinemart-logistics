// Mirrors Orders.tsx's getStatusColor exactly — kept here so the mobile
// screens (Home, Orders, the order sheet) share one status→style mapping
// instead of three copies that can drift out of sync with desktop.
export const ORDER_STATUS_STYLES: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  vendor_dispatched: 'bg-amber-100 text-amber-800',
  processing: 'bg-orange-100 text-orange-700',
  in_transit: 'bg-blue-100 text-blue-700',
  delivered: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-800',
};

export function getOrderStatusStyle(status: string): string {
  return ORDER_STATUS_STYLES[status] || 'bg-gray-100 text-gray-800';
}

export function getOrderStatusLabel(status: string): string {
  return status.replace(/_/g, ' ').toUpperCase();
}

export interface OrderLike {
  id: string;
  order_number?: number | null;
  woocommerce_order_id?: string | null;
  payment_reference?: string | null;
}

// Mirrors DashboardHome.tsx's recentOrderDisplayLabel exactly.
export function orderDisplayLabel(order: OrderLike): string {
  const wc = order.woocommerce_order_id?.trim();
  if (wc) return wc;
  if (order.order_number != null) return String(order.order_number);
  const ref = order.payment_reference?.trim();
  if (ref) return ref;
  return order.id.slice(0, 8).toUpperCase();
}

export function formatNaira(amount: number): string {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    maximumFractionDigits: 0,
  }).format(amount);
}
