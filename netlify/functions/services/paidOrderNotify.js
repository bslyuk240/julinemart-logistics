/**
 * Customer, staff, and vendor notifications after payment is confirmed.
 */
import { sendOrderEmailsForPaidOrder } from '../../../shared/orderConfirmationEmail.js';
import { sendPushToCustomer, sendPushToAllStaff } from './pushNotifications.js';

export async function notifyOnPaidOrder(adminClient, orderId, orderNumber) {
  if (!adminClient || !orderId) return { skipped: true, reason: 'missing_args' };

  const emailResult = await sendOrderEmailsForPaidOrder(adminClient, orderId);
  if (emailResult?.skipped) {
    return emailResult;
  }

  const orderNum = orderNumber != null ? String(orderNumber) : String(orderId).slice(0, 8);

  const { data: order } = await adminClient
    .from('orders')
    .select('customer_name, total_amount')
    .eq('id', orderId)
    .maybeSingle();

  sendPushToAllStaff({
    title: '🛍️ New Paid Order',
    message: `Order #${orderNum} from ${order?.customer_name || 'Customer'} — ₦${Number(order?.total_amount || 0).toLocaleString()}`,
    type: 'order_update',
    data: { order_id: orderId, order_number: orderNum },
  }).catch((e) => console.warn('[notifyOnPaidOrder] staff push failed:', e?.message));

  const { data: subOrders } = await adminClient
    .from('sub_orders')
    .select('id, vendor_id')
    .eq('main_order_id', orderId);

  const vendorIds = [...new Set((subOrders || []).map((s) => s.vendor_id).filter(Boolean))];

  for (const vendorId of vendorIds) {
    sendPushToCustomer(vendorId, {
      title: '🛍️ New Paid Order',
      message: `Order #${orderNum} — payment confirmed. Please prepare and process promptly.`,
      type: 'new_vendor_order',
      data: { order_id: orderId, order_number: orderNum },
    }).catch((e) => console.warn('[notifyOnPaidOrder] vendor push failed:', e?.message));
  }

  return { ...emailResult, push_staff: true, push_vendors: vendorIds.length };
}

/** @deprecated Use notifyOnPaidOrder */
export async function notifyVendorsOnPaidOrder(adminClient, orderId, orderNumber) {
  return notifyOnPaidOrder(adminClient, orderId, orderNumber);
}
