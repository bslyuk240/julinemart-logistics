// Fez Delivery - Webhook Receiver
// Receives automatic status updates from Fez when order status changes

import { createClient } from '@supabase/supabase-js';

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

// Map Fez status to JLO status
function mapFezStatus(fezStatus) {
  const statusMap = {
    'Pending Pick-Up': 'pending_pickup',
    'Picked-Up': 'picked_up',
    'Dispatched': 'in_transit',
    'Out for Delivery': 'in_transit',
    'Delivered': 'delivered',
    'Cancelled': 'cancelled',
    'Returned': 'returned',
  };

  return statusMap[fezStatus] || 'processing';
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
      .select('*, orders(id, overall_status)')
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

    // Check if all sub-orders are delivered/completed
    const { data: allSubOrders } = await supabase
      .from('sub_orders')
      .select('status')
      .eq('order_id', subOrder.orders.id);

    const allDelivered = allSubOrders?.every(so => 
      so.status === 'delivered' || so.status === 'cancelled'
    );

    // Update main order status if all sub-orders completed
    if (allDelivered) {
      await supabase
        .from('orders')
        .update({ overall_status: 'delivered' })
        .eq('id', subOrder.orders.id);

      console.log(`Main order ${subOrder.orders.id} marked as delivered`);
    }

    // Log activity
    await supabase.from('activity_logs').insert({
      user_id: 'fez_webhook',
      action: 'tracking_webhook_received',
      description: `Fez webhook: ${orderNo} → ${orderStatus}`,
      metadata: webhookData,
    });

    // Send notification to customer (optional)
    if (jloStatus === 'delivered') {
      // TODO: Trigger email/SMS notification
      console.log('Order delivered - notification should be sent');
    }

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