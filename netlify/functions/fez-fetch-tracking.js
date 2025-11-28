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
    'Out for Delivery': 'out_for_delivery',
    'Delivered': 'delivered',
    'Cancelled': 'cancelled',
    'Returned': 'returned',
  };

  return statusMap[fezStatus] || 'processing';
}

// Check if a value looks like a valid Fez tracking number (not a UUID)
function isValidFezTrackingNumber(value) {
  if (!value || typeof value !== 'string') return false;
  
  // UUIDs have format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidPattern.test(value)) return false;
  
  // Check for error messages
  if (value.toLowerCase().includes('already exists')) return false;
  if (value.toLowerCase().includes('error')) return false;
  
  // Valid Fez tracking numbers are typically alphanumeric (like GWD026112514)
  return value.length > 0 && value.length < 50;
}

// Extract order code from error message if present
function extractOrderCode(val) {
  if (typeof val !== 'string') return val;
  if (val.toLowerCase().includes('already exists')) {
    const match = val.match(/order\s+([A-Za-z0-9_-]+)/i);
    if (match) return match[1];
  }
  return val;
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

    // FIXED: Prioritize tracking_number and courier_waybill over courier_shipment_id
    // because courier_shipment_id sometimes contains the sub-order UUID instead of Fez tracking number
    const candidates = [
      subOrder.tracking_number,
      subOrder.courier_waybill,
      subOrder.courier_shipment_id,
    ];

    // Find the first valid Fez tracking number
    let rawTracking = null;
    for (const candidate of candidates) {
      const cleaned = extractOrderCode(candidate);
      if (isValidFezTrackingNumber(cleaned)) {
        rawTracking = cleaned;
        break;
      }
    }

    console.log('Tracking number candidates:', {
      tracking_number: subOrder.tracking_number,
      courier_waybill: subOrder.courier_waybill,
      courier_shipment_id: subOrder.courier_shipment_id,
      selected: rawTracking,
    });

    // 2. Check if tracking number exists
    if (!rawTracking) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'No valid Fez tracking number found. Please create shipment first.',
          debug: {
            tracking_number: subOrder.tracking_number,
            courier_waybill: subOrder.courier_waybill,
            courier_shipment_id: subOrder.courier_shipment_id,
          },
        }),
      };
    }

    const trackingNumber = rawTracking;

    // 3. Check courier credentials
    const courier = subOrder.couriers;
    if (!courier || !courier.api_user_id || !courier.api_password) {
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

    // 9. Save tracking events (avoid duplicates by checking existing)
    if (trackingData.history && trackingData.history.length > 0) {
      // Get existing tracking events to avoid duplicates
      const { data: existingEvents } = await supabase
        .from('tracking_events')
        .select('description, event_time')
        .eq('sub_order_id', subOrderId);

      const existingKeys = new Set(
        (existingEvents || []).map(e => `${e.description}-${e.event_time}`)
      );

      const newEvents = trackingData.history
        .filter(event => {
          const key = `${event.statusDescription}-${event.statusCreationDate}`;
          return !existingKeys.has(key);
        })
        .map(event => ({
          sub_order_id: subOrderId,
          status: mapFezStatus(event.orderStatus),
          location_name: event.location || 'Fez Delivery',
          event_time: event.statusCreationDate,
          description: event.statusDescription || event.orderStatus,
          source: 'fez_api',
          actor_type: 'courier',
        }));

      if (newEvents.length > 0) {
        const { error: insertError } = await supabase
          .from('tracking_events')
          .insert(newEvents);

        if (insertError) {
          console.error('Failed to insert tracking events:', insertError);
        } else {
          console.log(`Inserted ${newEvents.length} new tracking events`);
        }
      }
    }

    // 10. Log activity
    await supabase.from('activity_logs').insert({
      user_id: null,
      action: 'tracking_updated',
      resource_type: 'sub_order',
      resource_id: subOrderId,
      details: { 
        tracking_number: trackingNumber,
        fez_status: trackingData.order.orderStatus,
        jlo_status: jloStatus,
      },
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        data: {
          status: jloStatus,
          fez_status: trackingData.order.orderStatus,
          tracking_number: trackingNumber,
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