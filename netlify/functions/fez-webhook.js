// Fez Delivery - Webhook Receiver
// Receives automatic status updates from Fez when order status changes

import { createClient } from '@supabase/supabase-js';
import { sendApiCourierStatusCustomerEmail } from '../../shared/riderAssignedEmail.js';
import { sendTransactionalEmail } from './services/emailNotifications.js';
import { refreshOverallOrderStatus } from './helpers/orderStatusHelper.js';
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

// Map Fez status to JLO status (align with fez-fetch-tracking.js)
function mapFezStatus(fezStatus) {
  const statusMap = {
    // Confirmed from live API responses
    'Pending Pick-Up': 'pending_pickup',
    'Assigned To A Rider': 'assigned',
    // Expected progression (unconfirmed labels — update as Fez confirms)
    'Picked-Up': 'picked_up',
    'Dispatched': 'in_transit',
    'Prepared for Delivery': 'in_transit',
    'Out for Delivery': 'out_for_delivery',
    'Delivery in Progress': 'out_for_delivery',
    'Delivered': 'delivered',
    'Cancelled': 'cancelled',
    'Returned': 'returned',
    'Return in Progress': 'returned',
  };

  const mapped = statusMap[fezStatus];
  if (!mapped) console.warn('⚠️ Unknown Fez status — add to map:', fezStatus);
  return mapped || 'assigned';
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
      console.log('Sub-order not found for tracking:', orderNo);
      // Return 200 to acknowledge webhook even if order not found
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

    // Save tracking event
    await supabase.from('tracking_events').insert({
      sub_order_id: subOrder.id,
      status: jloStatus,
      location: statusDescription,
      timestamp: eventDate,
      description: statusDescription,
      raw_data: webhookData,
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
