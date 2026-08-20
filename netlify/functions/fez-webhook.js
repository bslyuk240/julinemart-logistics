// Fez Delivery - Webhook Receiver
// Receives automatic status updates from Fez when order status changes

import { createClient } from '@supabase/supabase-js';
import { sendApiCourierStatusCustomerEmail } from '../../shared/riderAssignedEmail.js';
import { sendTransactionalEmail } from './services/emailNotifications.js';
import { refreshOverallOrderStatus } from './helpers/orderStatusHelper.js';
import { insertTrackingEvent, mapFezStatus } from './services/fezTracking.js';
import { notifyManualShipmentCourierStatus } from './services/manualShipmentNotify.js';
import { checkRateLimit } from './services/rate-limit.js';
import {
  buildOrderDeepLink,
  extractCustomerIdFromOrder,
  extractOrderReference,
  sendPushToCustomer,
} from './services/pushNotifications.js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

async function processManualShipmentWebhook(orderNo, orderStatus, statusDescription, eventDate, webhookData) {
  const { data: byTracking } = await supabase
    .from('manual_shipments')
    .select('*')
    .eq('tracking_number', orderNo)
    .maybeSingle();

  let shipment = byTracking;
  if (!shipment) {
    const { data: byWaybill } = await supabase
      .from('manual_shipments')
      .select('*')
      .eq('courier_waybill', orderNo)
      .maybeSingle();
    shipment = byWaybill;
  }

  if (!shipment) return false;

  const jloStatus = mapFezStatus(orderStatus);
  const previousStatus = shipment.status;

  const { error: updateError } = await supabase
    .from('manual_shipments')
    .update({
      status: jloStatus,
      last_tracking_update: new Date().toISOString(),
    })
    .eq('id', shipment.id);

  if (updateError) throw updateError;

  await insertTrackingEvent(supabase, {
    manual_shipment_id: shipment.id,
    status: jloStatus,
    description: statusDescription || orderStatus || `Status: ${jloStatus}`,
    event_time: eventDate,
    source: 'webhook',
    source_reference: orderNo,
    metadata: webhookData,
  });

  await supabase.from('activity_logs').insert({
    user_id: 'fez_webhook',
    action: 'manual_shipment_tracking_webhook',
    description: `Fez webhook (manual): ${orderNo} → ${orderStatus}`,
    metadata: { shipment_id: shipment.id, shipment_code: shipment.shipment_code, ...webhookData },
  });

  if (previousStatus !== jloStatus) {
    try {
      await notifyManualShipmentCourierStatus(supabase, shipment, {
        jloStatus,
        tracking_number: orderNo,
        raw_status_hint: orderStatus || statusDescription,
      });
    } catch (mailErr) {
      console.error('notifyManualShipmentCourierStatus (fez-webhook):', mailErr?.message || mailErr);
    }
  }

  return { shipment, jloStatus, previousStatus };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ success: false, error: 'Method not allowed' }),
    };
  }

  const { limited, response } = await checkRateLimit(event, {
    name: 'fez-webhook',
    max: 60,
    window: '1 m',
    retryAfterSeconds: 60,
  });
  if (limited) return response;

  // Fez's webhook API (see fez-register-webhook.js's call to /webhooks/store)
  // only accepts a bare callback URL — it has no signature/secret header like
  // Paystack's x-paystack-signature. The workaround is a secret embedded in
  // the registered URL itself, checked here. Gated on FEZ_WEBHOOK_TOKEN being
  // set so deploying this can't break live tracking updates on its own: Fez
  // is still POSTing to the un-tokened URL until someone (1) sets this env
  // var and (2) re-registers the webhook URL with Fez to include ?token=...
  // (fez-register-webhook.js's WEBHOOK_URL constant needs updating first).
  // Until both of those happen, this check is a no-op and the endpoint is
  // exactly as open as it was before.
  const expectedToken = process.env.FEZ_WEBHOOK_TOKEN;
  if (expectedToken) {
    const providedToken = event.queryStringParameters?.token || '';
    if (providedToken !== expectedToken) {
      console.warn('[fez-webhook] rejected request with missing/invalid token');
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ success: false, error: 'Unauthorized' }),
      };
    }
  }

  try {
    const webhookData = JSON.parse(event.body || '{}');

    console.log('=== FEZ WEBHOOK RECEIVED ===');
    console.log('Webhook data:', JSON.stringify(webhookData, null, 2));

    // Fez webhook sends order status updates
    // Expected format based on Fez API docs:
    // {
    //   "orderNo": "JHAZ27012319",
    //   "orderStatus": "Delivered",
    //   "statusDescription": "Package delivered successfully",
    //   "deliveryDate": "2023-12-03 14:30:00"
    // }

    const orderNo = webhookData.orderNo || webhookData.tracking_number;
    const orderStatus = webhookData.orderStatus || webhookData.status;
    const statusDescription = webhookData.statusDescription || '';
    const eventDate = webhookData.deliveryDate || webhookData.statusDate || new Date().toISOString();

    if (!orderNo) {
      console.error('No order number in webhook data');
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'Missing orderNo' }),
      };
    }

    // Find sub-order by tracking number
    const { data: subOrders, error: findError } = await supabase
      .from('sub_orders')
      .select(
        '*, orders(id, order_number, overall_status, woocommerce_order_id, customer_name, customer_email, customer_phone, delivery_city, delivery_state, delivery_address, metadata), vendors(email, store_name, fez_collection_method)',
      )
      .eq('tracking_number', orderNo);

    if (findError) {
      console.error('Error finding sub-order:', findError);
      throw findError;
    }

    if (!subOrders || subOrders.length === 0) {
      console.log('Sub-order not found for tracking:', orderNo, '— checking manual shipments');
      const manualResult = await processManualShipmentWebhook(
        orderNo,
        orderStatus,
        statusDescription,
        eventDate,
        webhookData,
      );

      if (manualResult) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            message: 'Manual shipment webhook processed',
            data: {
              orderNo,
              shipment_code: manualResult.shipment.shipment_code,
              status: manualResult.jloStatus,
              updated: true,
            },
          }),
        };
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'Order not found in system',
        }),
      };
    }

    const subOrder = subOrders[0];
    const jloStatus = mapFezStatus(orderStatus);
    const previousStatus = subOrder.status;

    console.log(`Updating sub-order ${subOrder.id} to status: ${jloStatus}`);

    // Update sub-order status
    const { error: updateError } = await supabase
      .from('sub_orders')
      .update({
        status: jloStatus,
        last_tracking_update: new Date().toISOString(),
      })
      .eq('id', subOrder.id);

    if (updateError) {
      console.error('Failed to update sub-order:', updateError);
      throw updateError;
    }

    await insertTrackingEvent(supabase, {
      sub_order_id: subOrder.id,
      status: jloStatus,
      description: statusDescription || orderStatus || `Status: ${jloStatus}`,
      event_time: eventDate,
      source: 'webhook',
      source_reference: orderNo,
      metadata: webhookData,
    });

    if (subOrder.orders?.id) {
      await refreshOverallOrderStatus(supabase, subOrder.orders.id);
    }

    // Vendor pickup alert — when Fez physically collects from vendor's shop
    if (
      jloStatus === 'picked_up' &&
      previousStatus !== 'picked_up' &&
      subOrder.vendors?.fez_collection_method === 'fez_pickup' &&
      subOrder.vendors?.email
    ) {
      sendTransactionalEmail({
        templateName: 'Vendor Fez Pickup Confirmed',
        to: subOrder.vendors.email,
        data: {
          vendor_name:    subOrder.vendors.store_name || 'Vendor',
          order_number:   subOrder.orders?.order_number || subOrder.id,
          tracking_number: orderNo,
        },
      }).catch(err => console.error('vendor pickup alert email failed:', err));
    }

    if (previousStatus !== jloStatus) {
      const customerId = extractCustomerIdFromOrder(subOrder.orders);
      const orderRef = extractOrderReference(subOrder.orders) || subOrder.orders?.id || subOrder.id;
      const deepLink = buildOrderDeepLink(orderRef);

      let pushInput = null;
      if (jloStatus === 'in_transit') {
        pushInput = {
          title: 'Order in transit',
          message: `Your order ${orderRef} is on the move.`,
          type: 'order_update',
          data: {
            status: jloStatus,
            orderReference: String(orderRef),
            trackingNumber: orderNo,
            ...(deepLink ? { targetPath: deepLink } : {}),
          },
        };
      } else if (jloStatus === 'out_for_delivery') {
        pushInput = {
          title: 'Out for delivery',
          message: `Your order ${orderRef} is out for delivery.`,
          type: 'order_update',
          data: {
            status: jloStatus,
            orderReference: String(orderRef),
            trackingNumber: orderNo,
            ...(deepLink ? { targetPath: deepLink } : {}),
          },
        };
      } else if (jloStatus === 'delivered') {
        pushInput = {
          title: 'Order delivered',
          message: `Your order ${orderRef} has been delivered.`,
          type: 'order_update',
          data: {
            status: jloStatus,
            orderReference: String(orderRef),
            trackingNumber: orderNo,
            ...(deepLink ? { targetPath: deepLink } : {}),
          },
        };
      }

      if (pushInput) {
        const pushResult = await sendPushToCustomer(customerId, pushInput);
        if (!pushResult.success && !pushResult.skipped) {
          console.warn('Fez webhook push failed:', pushResult);
        }
      }

      const order = subOrder.orders;
      if (order?.customer_email) {
        let courierDisplay = 'Fez Delivery';
        if (subOrder.courier_id) {
          const { data: cRow } = await supabase
            .from('couriers')
            .select('name')
            .eq('id', subOrder.courier_id)
            .maybeSingle();
          if (cRow?.name) courierDisplay = cRow.name;
        }
        const fezTrackUrl =
          subOrder.courier_tracking_url ||
          `https://web.fezdelivery.co/track-delivery?tracking=${encodeURIComponent(String(orderNo))}`;
        try {
          await sendApiCourierStatusCustomerEmail(supabase, {
            jloStatus,
            orderId: order.id,
            orderNumber: order.order_number ?? order.id,
            customer_name: order.customer_name,
            customer_email: order.customer_email,
            tracking_number: orderNo,
            courier_tracking_url: fezTrackUrl,
            courier_display_name: courierDisplay,
            delivery_city: order.delivery_city,
            delivery_state: order.delivery_state,
            raw_status_hint: orderStatus || statusDescription,
          });
        } catch (mailErr) {
          console.error('sendApiCourierStatusCustomerEmail (fez-webhook):', mailErr?.message || mailErr);
        }
      }
    }

    // Log activity
    await supabase.from('activity_logs').insert({
      user_id: 'fez_webhook',
      action: 'tracking_webhook_received',
      description: `Fez webhook: ${orderNo} → ${orderStatus}`,
      metadata: webhookData,
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Webhook processed successfully',
        data: {
          orderNo,
          status: jloStatus,
          updated: true,
        },
      }),
    };
  } catch (error) {
    console.error('Error processing Fez webhook:', error);
    
    // Still return 200 to Fez so they don't retry
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: false,
        error: error.message,
        message: 'Webhook received but processing failed',
      }),
    };
  }
};
