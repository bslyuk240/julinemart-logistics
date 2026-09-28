import { recordStaffAudit } from '../auditLog.js';

export async function recordFulfilmentAction(supabase, event, authUser, {
  action,
  orderId = null,
  subOrderId = null,
  shipmentId = null,
  provider = null,
  metadata = {},
}) {
  const { error } = await supabase.from('shipping_fulfilment_actions').insert({
    user_id: authUser?.id || null,
    action,
    order_id: orderId,
    sub_order_id: subOrderId,
    shipment_id: shipmentId,
    provider,
    metadata,
  });
  if (error) console.warn('[fulfilmentAudit] insert failed:', error.message);

  await recordStaffAudit(event, authUser, {
    action: action.toUpperCase(),
    resource_type: 'sub_order',
    resource_id: subOrderId || orderId,
    details: { provider, shipment_id: shipmentId, ...metadata },
  });
}
