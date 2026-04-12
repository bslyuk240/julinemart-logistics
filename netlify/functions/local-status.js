// FIXED VERSION: netlify/functions/local-status.js
// Added comprehensive logging and error handling for refreshOverallOrderStatus

import { createClient } from '@supabase/supabase-js';
import { sendLocalDeliveryStatusEmail } from '../../shared/riderAssignedEmail.js';
import { refreshOverallOrderStatus } from './helpers/orderStatusHelper.js';
import {
  buildOrderDeepLink,
  extractCustomerIdFromOrder,
  extractOrderReference,
  sendPushToCustomer,
} from './services/pushNotifications.js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const ALLOWED_STATUSES = new Set(['out_for_delivery', 'delivered']);

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ success: false, error: 'Method Not Allowed' }),
    };
  }

  if (
    !process.env.SUPABASE_SERVICE_ROLE_KEY ||
    !(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL)
  ) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: 'Missing Supabase configuration' }),
    };
  }

  try {
    const { sub_order_id, status } = JSON.parse(event.body || '{}');

    console.log('=== LOCAL STATUS UPDATE REQUEST ===');
    console.log('Sub-order ID:', sub_order_id);
    console.log('Target status:', status);

    if (!sub_order_id || !status) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Missing required fields: sub_order_id, status',
        }),
      };
    }

    if (!ALLOWED_STATUSES.has(status)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: `Status must be one of: ${Array.from(ALLOWED_STATUSES).join(', ')}`,
        }),
      };
    }

    // Fetch sub-order with courier info AND main_order_id
    const { data: subOrder, error: subOrderError } = await supabase
      .from('sub_orders')
      .select('id, courier_id, main_order_id, status')
      .eq('id', sub_order_id)
      .single();

    if (subOrderError || !subOrder) {
      console.error('Sub-order lookup failed:', subOrderError);
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ success: false, error: 'Sub-order not found' }),
      };
    }

    console.log('Found sub-order:', {
      id: subOrder.id,
      current_status: subOrder.status,
      main_order_id: subOrder.main_order_id,
      courier_id: subOrder.courier_id,
    });

    // Verify this is a local rider
    const { data: courier, error: courierError } = await supabase
      .from('couriers')
      .select('code')
      .eq('id', subOrder.courier_id)
      .maybeSingle();

    const courierCode = courier?.code?.toLowerCase();
    console.log('Courier code:', courierCode);

    if (courierError || courierCode !== 'local-rider') {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Status updates are only allowed for local rider sub-orders',
        }),
      };
    }

    // Update sub-order status
    console.log(`Updating sub-order ${sub_order_id} from "${subOrder.status}" to "${status}"`);
    
    const { data: updated, error: updateError } = await supabase
      .from('sub_orders')
      .update({ status })
      .eq('id', sub_order_id)
      .select('id, status')
      .single();

    if (updateError) {
      console.error('Sub-order update failed:', updateError);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ success: false, error: updateError.message }),
      };
    }

    console.log('✅ Sub-order status updated:', updated);

    // Create tracking event
    const description =
      status === 'out_for_delivery'
        ? 'Local rider picked up the package and is out for delivery'
        : 'Local rider confirmed delivery';

    const { error: trackingError } = await supabase.from('tracking_events').insert({
      sub_order_id,
      status,
      description,
      actor_type: 'user',
      source: 'manual_assignment',
    });

    if (trackingError) {
      console.warn('Failed to create tracking event:', trackingError);
      // Don't fail the whole request if tracking event fails
    }

    // ✅ CRITICAL: Refresh overall order status
    if (subOrder?.main_order_id) {
      console.log('🔄 Refreshing overall order status for:', subOrder.main_order_id);
      
      try {
        const newOverallStatus = await refreshOverallOrderStatus(supabase, subOrder.main_order_id);
        console.log('✅ Overall order status refreshed to:', newOverallStatus);
      } catch (refreshError) {
        console.error('❌ FAILED to refresh overall order status:', refreshError);
        // Log the error but don't fail the request
        // The sub-order status was updated successfully
        console.error('Full refresh error:', {
          message: refreshError?.message,
          stack: refreshError?.stack,
          main_order_id: subOrder.main_order_id,
        });
      }
    } else {
      console.warn('⚠️ No main_order_id found, cannot refresh overall status');
    }

    if (subOrder.status !== status && subOrder.main_order_id) {
      const { data: orderRecord, error: orderError } = await supabase
        .from('orders')
        .select(
          'id, order_number, customer_name, customer_email, delivery_city, delivery_state, metadata',
        )
        .eq('id', subOrder.main_order_id)
        .maybeSingle();

      const { data: subDetails } = await supabase
        .from('sub_orders')
        .select('tracking_number, rider_name, rider_phone')
        .eq('id', sub_order_id)
        .maybeSingle();

      if (orderError) {
        console.warn('Failed to load order for local-status push:', orderError.message);
      } else if (orderRecord) {
        const customerId = extractCustomerIdFromOrder(orderRecord);
        const orderRef = extractOrderReference(orderRecord) || subOrder.main_order_id;
        const deepLink = buildOrderDeepLink(orderRef);
        const pushMeta = {
          status,
          orderReference: String(orderRef),
          ...(deepLink ? { deepLink } : {}),
        };

        const pushInput =
          status === 'out_for_delivery'
            ? {
                title: 'Order out for delivery',
                message: `Your order ${orderRef} is on the way.`,
                type: 'order_update',
                data: pushMeta,
              }
            : {
                title: 'Order delivered',
                message: `Your order ${orderRef} has been delivered.`,
                type: 'order_update',
                data: pushMeta,
              };

        const pushResult = await sendPushToCustomer(customerId, pushInput);
        if (!pushResult.success && !pushResult.skipped) {
          console.warn('Local-status push failed:', pushResult);
        }

        try {
          await sendLocalDeliveryStatusEmail(supabase, {
            phase: status,
            orderId: subOrder.main_order_id,
            orderNumber: orderRecord.order_number ?? orderRef,
            customer_name: orderRecord.customer_name,
            customer_email: orderRecord.customer_email,
            tracking_number: subDetails?.tracking_number || '',
            rider_name: subDetails?.rider_name || '',
            rider_phone: subDetails?.rider_phone || '',
            delivery_city: orderRecord.delivery_city,
            delivery_state: orderRecord.delivery_state,
          });
        } catch (mailErr) {
          console.error('sendLocalDeliveryStatusEmail:', mailErr?.message || mailErr);
        }
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, data: updated }),
    };
  } catch (error) {
    console.error('❌ Local status update error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Internal server error',
        message: error?.message,
      }),
    };
  }
};
