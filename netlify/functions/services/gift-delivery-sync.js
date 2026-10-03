/**
 * Keep gift_orders in step with the shipment.
 *
 * Courier (FEZ) and rider deliveries update sub_orders and orders but never
 * gift_orders, so a gift's own timeline used to stay on "On the way" until ops
 * clicked "Mark delivered". Called from refreshOverallOrderStatus whenever the
 * order flips to delivered.
 */
export async function syncGiftDelivered(client, orderId) {
  const { data: gift, error } = await client
    .from('gift_orders')
    .select('id, gift_status')
    .eq('order_id', orderId)
    .maybeSingle();
  if (error) throw error;
  if (!gift || ['delivered', 'cancelled'].includes(gift.gift_status)) return false;

  const now = new Date().toISOString();
  const { error: updErr } = await client
    .from('gift_orders')
    .update({ gift_status: 'delivered', completed_at: now, updated_at: now })
    .eq('id', gift.id);
  if (updErr) throw updErr;

  await client.from('gift_order_events').insert({
    gift_order_id: gift.id,
    status: 'delivered',
    note: 'Delivery confirmed by the courier or rider',
  });
  return true;
}
