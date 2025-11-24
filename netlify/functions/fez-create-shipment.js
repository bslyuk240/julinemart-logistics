// Fez Delivery - Create Shipment Function
// Creates a shipment on Fez platform and returns tracking number

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

// Authenticate with Fez API
async function authenticateFez(userId, password, baseUrl) {
  try {
    const response = await fetch(`${baseUrl}/user/authenticate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        password: password,
      }),
    });

    const data = await response.json();

    if (data.status === 'Success') {
      return {
        authToken: data.authDetails.authToken,
        secretKey: data.orgDetails['secret-key'],
      };
    } else {
      throw new Error(data.description || 'Authentication failed');
    }
  } catch (error) {
    console.error('Fez authentication error:', error);
    throw new Error('Failed to authenticate with Fez API');
  }
}

// Create shipment on Fez
async function createFezShipment(authToken, secretKey, baseUrl, shipmentData) {
  try {
    const response = await fetch(`${baseUrl}/order`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
        'secret-key': secretKey,
      },
      body: JSON.stringify([shipmentData]), // Fez expects an array
    });

    const data = await response.json();

    if (data.status === 'Success') {
      const trackingNumber = Object.values(data.orderNos)[0];
      return {
        success: true,
        trackingNumber: trackingNumber,
        orderNos: data.orderNos,
      };
    } else {
      throw new Error(data.description || 'Failed to create shipment');
    }
  } catch (error) {
    console.error('Fez create shipment error:', error);
    throw error;
  }
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
    const { subOrderId } = JSON.parse(event.body || '{}');

    if (!subOrderId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'subOrderId is required' }),
      };
    }

    console.log('Creating Fez shipment for sub-order:', subOrderId);

    // Fetch sub-order details
    const { data: subOrder, error: subOrderError } = await supabase
      .from('sub_orders')
      .select(`
        *,
        orders (
          id,
          customer_name,
          customer_email,
          customer_phone,
          delivery_address,
          delivery_city,
          delivery_state,
          total_amount
        ),
        hubs (
          name,
          address,
          city,
          state,
          phone
        ),
        couriers (
          code,
          api_base_url,
          api_user_id,
          api_password
        )
      `)
      .eq('id', subOrderId)
      .single();

    if (subOrderError || !subOrder) {
      throw new Error('Sub-order not found');
    }

    // Get FEZ credentials
    const courier = subOrder.couriers;
    if (!courier?.api_user_id || !courier?.api_password) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Courier API credentials not configured.',
        }),
      };
    }

    const baseUrl = courier.api_base_url || 'https://apisandbox.fezdelivery.co/v1';

    // Authenticate
    console.log('Authenticating with Fez API...');
    const { authToken, secretKey } = await authenticateFez(
      courier.api_user_id,
      courier.api_password,
      baseUrl
    );

    console.log('Authentication successful');

    // Items array guard
    const items = Array.isArray(subOrder.items) ? subOrder.items : [];
    const totalWeight = items.reduce((sum, item) => {
      return sum + (Number(item.weight || 0) * Number(item.quantity || 1));
    }, 0);

    // Prepare shipment
    const shipmentData = {
      recipientAddress: subOrder.orders?.delivery_address || '',
      recipientState: subOrder.orders?.delivery_state || '',
      recipientName: subOrder.orders?.customer_name || '',
      recipientPhone: subOrder.orders?.customer_phone || '',
      recipientEmail: subOrder.orders?.customer_email || '',
      uniqueID: subOrder.id,
      BatchID: subOrder.orders?.id || subOrder.id, // FIXED
      itemDescription: items.map(i => `${i.quantity}x ${i.name}`).join(', '),
      valueOfItem: String(Math.round((subOrder.shipping_cost || 0) + 1000)), // FIXED
      weight: Math.max(1, Math.round(totalWeight)),
      pickUpAddress: subOrder.hubs?.address || '',
      pickUpState: subOrder.hubs?.state || '',
      additionalDetails: `Hub: ${subOrder.hubs?.name || ''}, ${subOrder.hubs?.city || ''}`,
    };

    console.log('Creating shipment with data:', shipmentData);

    // Create shipment in Fez
    const result = await createFezShipment(authToken, secretKey, baseUrl, shipmentData);
    console.log('Shipment created:', result.trackingNumber);

    // Update DB
    await supabase
      .from('sub_orders')
      .update({
        tracking_number: result.trackingNumber,
        courier_shipment_id: result.trackingNumber,
        courier_tracking_url: `${baseUrl}/order/track/${result.trackingNumber}`,
        status: 'pending_pickup',
        last_tracking_update: new Date().toISOString(),
      })
      .eq('id', subOrderId);

    // Activity log (fixed schema)
    await supabase.from('activity_logs').insert({
      user_id: null,
      action: 'courier_shipment_created',
      resource_type: 'sub_order',
      resource_id: subOrderId,
      details: {
        courier: 'fez',
        tracking_number: result.trackingNumber,
      },
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        data: {
          tracking_number: result.trackingNumber,
          courier_shipment_id: result.trackingNumber,
          courier_tracking_url: `${baseUrl}/order/track/${result.trackingNumber}`,
          message: 'Shipment created successfully on Fez Delivery',
        },
      }),
    };

  } catch (error) {
    console.error('Error creating Fez shipment:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Failed to create shipment',
        message: error.message,
      }),
    };
  }
};
