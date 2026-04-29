const STATUS_PRIORITY = {
  pending: 1,
  vendor_dispatched: 2,
  processing: 2,
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

// Maps JLO sub-order status → orders.overall_status enum
// Enum values: pending | processing | partially_shipped | shipped | delivered | cancelled | refunded
const SUB_STATUS_TO_ORDER_STATUS = {
  pending: 'pending',
  vendor_dispatched: 'processing',
  processing: 'processing',
  assigned: 'processing',
  pending_pickup: 'processing',
  picked_up: 'partially_shipped',
  in_transit: 'shipped',
  out_for_delivery: 'shipped',
  delivered: 'delivered',
  returned: 'refunded',
  failed: 'cancelled',
  cancelled: 'cancelled',
};

export async function refreshOverallOrderStatus(supabase, orderId) {
  if (!orderId) return null;

  const { data: statuses } = await supabase
    .from('sub_orders')
    .select('status')
    .eq('main_order_id', orderId);

  if (!statuses || statuses.length === 0) return null;

  const bestSubStatus = statuses.reduce((acc, so) => {
    if (!so?.status) return acc;
    const currentPriority = STATUS_PRIORITY[so.status] ?? 0;
    const accPriority = STATUS_PRIORITY[acc] ?? 0;
    return currentPriority > accPriority ? so.status : acc;
  }, 'pending');

  const orderStatus = SUB_STATUS_TO_ORDER_STATUS[bestSubStatus] || 'processing';

  const { data: order } = await supabase
    .from('orders')
    .select('overall_status')
    .eq('id', orderId)
    .single();

  if (!order) return null;

  if (orderStatus !== order.overall_status) {
    await supabase.from('orders').update({ overall_status: orderStatus }).eq('id', orderId);
  }

  return orderStatus;
}
