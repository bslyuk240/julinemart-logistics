import { Request, Response } from 'express';
import { createHmac } from 'crypto';
import { createOrderWithSubOrders } from '../../services/orderSplitter';
import { assignCourierToSubOrder } from '../../services/courierAssignment';

// Minimal WooCommerce types for fields we use
type WooLineItemMeta = { key: string; value: unknown };
type WooLineItem = {
  product_id: number;
  name: string;
  sku?: string;
  quantity: number;
  price: string | number;
  meta_data?: WooLineItemMeta[];
};
type WooOrder = {
  id: number | string;
  billing: { first_name: string; last_name: string; email: string; phone: string };
  shipping: { address_1: string; city: string; state: string };
  total: string | number;
  shipping_total: string | number;
  line_items: WooLineItem[];
};

function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const hash = createHmac('sha256', secret)
    .update(payload)
    .digest('base64');
  return hash === signature;
}

export async function woocommerceWebhookHandler(req: Request, res: Response) {
  try {
    // Verify webhook signature
    const signature = req.headers['x-wc-webhook-signature'] as string;
    const webhookSecret = process.env.WEBHOOK_SECRET;

    if (webhookSecret && signature) {
      const isValid = verifyWebhookSignature(
        JSON.stringify(req.body),
        signature,
        webhookSecret
      );

      if (!isValid) {
        return res.status(401).json({ error: 'Invalid webhook signature' });
      }
    }

    const wooOrder = req.body as WooOrder;

    // Extract order data
    const toNumber = (v: string | number) =>
      typeof v === 'string' ? parseFloat(v) : v;
    const mainOrder = {
      woocommerceOrderId: wooOrder.id.toString(),
      customerName: `${wooOrder.billing.first_name} ${wooOrder.billing.last_name}`,
      customerEmail: wooOrder.billing.email,
      customerPhone: wooOrder.billing.phone,
      deliveryAddress: wooOrder.shipping.address_1,
      deliveryCity: wooOrder.shipping.city,
      deliveryState: wooOrder.shipping.state,
      deliveryZone: '',
      subtotal: toNumber(wooOrder.total) - toNumber(wooOrder.shipping_total),
      totalAmount: toNumber(wooOrder.total),
      shippingFeePaid: toNumber(wooOrder.shipping_total),
      items: wooOrder.line_items.map((item: WooLineItem) => {
        const vendorMeta = item.meta_data?.find((m) => m.key === 'vendor_id');
        const hubMeta = item.meta_data?.find((m) => m.key === 'hub_id');
        const unitPrice = typeof item.price === 'string' ? parseFloat(item.price) : item.price;
        const vendorId = typeof vendorMeta?.value === 'string' ? vendorMeta.value : 'default';
        const hubId = typeof hubMeta?.value === 'string' ? hubMeta.value : 'default';
        return {
          productId: item.product_id.toString(),
          productName: item.name,
          productSku: item.sku,
          quantity: item.quantity,
          unitPrice,
          vendorId,
          hubId,
        };
      }),
    };

    // Create order and sub-orders
    const result = await createOrderWithSubOrders(mainOrder);

    // Auto-assign couriers to each sub-order
    const assignmentPromises = result.subOrders.map((subOrder) =>
      assignCourierToSubOrder(subOrder.id)
    );

    await Promise.all(assignmentPromises);

    return res.status(200).json({
      success: true,
      message: 'Order processed successfully',
      orderId: result.order.id,
      subOrderCount: result.subOrders.length,
    });
  } catch (error) {
    console.error('Webhook processing error:', error);
    return res.status(500).json({
      error: 'Failed to process webhook',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
