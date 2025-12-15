// Fez Delivery - Fetch Tracking Function
// Gets live tracking updates from Fez API with DATABASE AUTHENTICATION

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

// Authenticate with Fez API - NOW FETCHES FROM DATABASE FIRST!
async function authenticateFez(userId, password, baseUrl) {
  // NEW: If credentials not provided, fetch from database
  if (!userId || !password) {
    console.log('🔍 Fetching Fez credentials from database...');
    
    const { data: courier, error: dbError } = await supabase
      .from('couriers')
      .select('api_user_id, api_password, api_base_url')
      .eq('code', 'fez')
      .eq('api_enabled', true)
      .single();

    if (dbError || !courier) {
      console.error('❌ Failed to fetch credentials from database:', dbError);
      throw new Error('Fez API credentials not configured in database');
    }

    userId = courier.api_user_id;
    password = courier.api_password;
    baseUrl = courier.api_base_url || baseUrl || 'https://apisandbox.fezdelivery.co/v1';
    
    console.log('✅ Using credentials from database');
    console.log('   User ID:', userId);
    console.log('   Base URL:', baseUrl);
  }

  // Authenticate with Fez
  try {
    console.log('🔐 Authenticating with Fez API...');
    
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
      console.log('✅ Fez authentication successful!');
      return {
        authToken: data.authDetails.authToken,
        secretKey: data.orgDetails['secret-key'],
      };
    } else {
      throw new Error(data.description || 'Authentication failed');
    }
  } catch (error) {
    console.error('❌ Fez authentication error:', error);
    throw new Error('Failed to authenticate with Fez API: ' + error.message);
  }
}

// Fetch tracking from Fez
async function fetchFezTracking(authToken, secretKey, baseUrl, trackingNumber) {
  try {
    console.log('📦 Fetching tracking for:', trackingNumber);
    
    const response = await fetch(`${baseUrl}/order/track/${trackingNumber}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'secret-key': secretKey,
      },
    });

    const data = await response.json();

    if (data.status === 'Success') {
      console.log('✅ Tracking data fetched successfully');
      return {
        success: true,
        order: data.order,
        history: data.history,
      };
    } else {
      throw new Error(data.description || 'Failed to fetch tracking');
    }
  } catch (error) {
    console.error('❌ Fez tracking error:', error);
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
  if (value.toLowerCase().includes('error') || value.toLowerCase().includes('failed')) {
    return false;
  }
  
  return true;
}

export async function handler(event) {
  // CORS preflight
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
    console.log('=== FEZ FETCH TRACKING REQUEST ===');
    console.log('Query params:', event.queryStringParameters);

    // Get subOrderId from query parameter
    const subOrderId = event.queryStringParameters?.subOrderId;

    if (!subOrderId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'subOrderId is required',
        }),
      };
    }

    // 1. Fetch sub-order with courier details
    console.log('📋 Fetching sub-order:', subOrderId);
    
    const { data: subOrder, error: subOrderError } = await supabase
      .from('sub_orders')
      .select(`
        *,
        couriers (
          code,
          api_user_id,
          api_password,
          api_base_url,
          api_enabled
        )
      `)
      .eq('id', subOrderId)
      .single();

    if (subOrderError || !subOrder) {
      console.error('❌ Sub-order not found:', subOrderError);
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Sub-order not found',
        }),
      };
    }

    console.log('✅ Sub-order found:', {
      order_id: subOrder.order_id,
      tracking: subOrder.tracking_number,
      courier_waybill: subOrder.courier_waybill,
    });

    // 2. Get tracking number (prefer courier_waybill, then tracking_number)
    const rawTracking = subOrder.courier_waybill || subOrder.tracking_number;

    if (!rawTracking || !isValidFezTrackingNumber(rawTracking)) {
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

    // 3. Check courier details - but we'll fetch fresh credentials anyway
    const courier = subOrder.couriers;
    const baseUrl = courier?.api_base_url || 'https://apisandbox.fezdelivery.co/v1';

    // 4. Authenticate (will automatically fetch from database)
    console.log('🔐 Starting authentication...');
    const { authToken, secretKey } = await authenticateFez(null, null, baseUrl);
    // Passing null forces database lookup - this is the KEY FIX!

    // 5. Fetch tracking
    console.log('📦 Fetching tracking data...');
    const trackingData = await fetchFezTracking(
      authToken,
      secretKey,
      baseUrl,
      trackingNumber
    );

    // 6. Map status
    const jloStatus = mapFezStatus(trackingData.order.orderStatus);
    console.log('📊 Status mapping:', {
      fez_status: trackingData.order.orderStatus,
      jlo_status: jloStatus,
    });

    // 7. Update sub-order with latest tracking
    const { error: updateError } = await supabase
      .from('sub_orders')
      .update({
        status: jloStatus,
        last_tracking_update: new Date().toISOString(),
      })
      .eq('id', subOrderId);

    if (updateError) {
      console.error('⚠️ Failed to update sub-order:', updateError);
    } else {
      console.log('✅ Sub-order status updated');
    }

    // 8. Save tracking events (avoid duplicates by checking existing)
    if (trackingData.history && trackingData.history.length > 0) {
      console.log('💾 Saving tracking events...');
      
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
          console.error('⚠️ Failed to insert tracking events:', insertError);
        } else {
          console.log(`✅ Inserted ${newEvents.length} new tracking events`);
        }
      } else {
        console.log('ℹ️ No new tracking events to insert');
      }
    }

    // 9. Log activity
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

    console.log('✅ Tracking fetch complete!');

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
    console.error('❌ Error fetching tracking:', error);
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
}