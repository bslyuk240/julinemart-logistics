const STATUS_PRIORITY = {
  pending: 1,
  vendor_dispatched: 2,
  processing: 2,
  assigned: 3,
  picked_up: 4,
  in_transit: 5,
  out_for_delivery: 6,
  delivered: 7,
  returned: 8,
  failed: 9,
  cancelled: 10,
};

export async function refreshOverallOrderStatus(supabase, orderId) {
  if (!orderId) return null;

  const { data: statuses } = await supabase
    .from('sub_orders')
    .select('status')
    .eq('main_order_id', orderId);

  if (!statuses || statuses.length === 0) return null;

  const best = statuses.reduce((acc, so) => {
    if (!so?.status) return acc;
    const currentPriority = STATUS_PRIORITY[so.status] ?? 0;
    const accPriority = STATUS_PRIORITY[acc] ?? 0;
    return currentPriority > accPriority ? so.status : acc;
  }, 'pending');

  const { data: order } = await supabase
    .from('orders')
    .select('overall_status')
    .eq('id', orderId)
    .single();

  if (!order) return null;

  if (best && best !== order.overall_status) {
    await supabase.from('orders').update({ overall_status: best }).eq('id', orderId);
  }

  return best;
}
