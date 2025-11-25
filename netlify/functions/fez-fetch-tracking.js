// Fez Delivery - Fetch Tracking Function
// Gets live tracking updates from Fez API

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

// Fetch tracking from Fez
async function fetchFezTracking(authToken, secretKey, baseUrl, trackingNumber) {
  try {
    const response = await fetch(`${baseUrl}/order/track/${trackingNumber}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'secret-key': secretKey,
      },
    });

    const data = await response.json();

    if (data.status === 'Success') {
      return {
        success: true,
        order: data.order,
        history: data.history,
      };
    } else {
      throw new Error(data.description || 'Failed to fetch tracking');
    }
  } catch (error) {
    console.error('Fez tracking error:', error);
    throw error;
  }
}

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

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ success: false, error: 'Method not allowed' }),
    };
  }

  try {
    // Prefer query param ?subOrderId=... (front-end calls)
    const querySubOrderId = event.queryStringParameters?.subOrderId;
    const pathParts = event.path.split('/');
    const pathSubOrderId = pathParts[pathParts.length - 1];
    const subOrderId = querySubOrderId || pathSubOrderId;

    if (!subOrderId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'subOrderId is required' }),
      };
    }

    console.log('Fetching tracking for sub-order:', subOrderId);

    // 1. Get sub-order details
    const { data: subOrder, error: subOrderError } = await supabase
      .from('sub_orders')
      .select(`
        *,
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

    // Prefer the FEZ tracking UUID, then order code/waybill
    const rawTracking =
      subOrder.courier_shipment_id ||
      subOrder.tracking_number ||
      subOrder.courier_waybill;

    // 2. Check if tracking number exists
    if (!rawTracking) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'No tracking number found. Please create shipment first.',
        }),
      };
    }

    // Clean tracking number for FEZ: strip "already exists" message, fallback to order code
    const extractOrderCode = (val) => {
      if (typeof val !== 'string') return val;
      if (val.toLowerCase().includes('already exists')) {
        const match = val.match(/order\s+([A-Za-z0-9_-]+)/i);
        if (match) return match[1];
      }
      return val;
    };

    let trackingNumber = extractOrderCode(rawTracking);

    // 3. Check courier credentials
    const courier = subOrder.couriers;
    if (!courier.api_user_id || !courier.api_password) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Courier API credentials not configured.',
        }),
      };
    }

    // 4. Get API base URL
    const baseUrl = courier.api_base_url || 'https://apisandbox.fezdelivery.co/v1';

    // 5. Authenticate
    console.log('Authenticating with Fez API...');
    const { authToken, secretKey } = await authenticateFez(
      courier.api_user_id,
      courier.api_password,
      baseUrl
    );

    // 6. Fetch tracking
    console.log('Fetching tracking for:', trackingNumber);
    const trackingData = await fetchFezTracking(
      authToken,
      secretKey,
      baseUrl,
      trackingNumber
    );

    // 7. Map status
    const jloStatus = mapFezStatus(trackingData.order.orderStatus);

    // 8. Update sub-order with latest tracking
    const { error: updateError } = await supabase
      .from('sub_orders')
      .update({
        status: jloStatus,
        last_tracking_update: new Date().toISOString(),
      })
      .eq('id', subOrderId);

    if (updateError) {
      console.error('Failed to update sub-order:', updateError);
    }

    // 9. Save tracking events
    if (trackingData.history && trackingData.history.length > 0) {
      const trackingEvents = trackingData.history.map(event => ({
        sub_order_id: subOrderId,
        status: mapFezStatus(event.orderStatus),
        location: event.statusDescription || event.orderStatus,
        timestamp: event.statusCreationDate,
        description: event.statusDescription,
        raw_data: event,
      }));

      await supabase.from('tracking_events').insert(trackingEvents);
    }

    // 10. Log activity
    await supabase.from('activity_logs').insert({
      user_id: 'system',
      action: 'tracking_updated',
      description: `Tracking updated: ${trackingData.order.orderStatus}`,
      metadata: { subOrderId, status: trackingData.order.orderStatus },
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        data: {
          status: jloStatus,
          fez_status: trackingData.order.orderStatus,
          tracking_number: subOrder.tracking_number,
          order_details: trackingData.order,
          history: trackingData.history,
          last_update: new Date().toISOString(),
        },
      }),
    };
  } catch (error) {
    console.error('Error fetching tracking:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Failed to fetch tracking',
        message: error.message,
      }),
    };
  }
};
