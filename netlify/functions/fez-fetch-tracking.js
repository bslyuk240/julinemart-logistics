// Fez Delivery - Fetch Tracking Function
// SAFE PRODUCTION VERSION (Live + Sandbox)
// Netlify compatible – Pure JavaScript

import { createClient } from '@supabase/supabase-js';
import { sendApiCourierStatusCustomerEmail } from '../../shared/riderAssignedEmail.js';
import { refreshOverallOrderStatus } from './helpers/orderStatusHelper.js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

// --------------------------------------------------
// RESOLVE ENVIRONMENT (order → courier → netlify)
// --------------------------------------------------
function resolveEnvironment(subOrder, courier) {
  if (subOrder?.environment) return subOrder.environment;
  if (courier?.api_config?.environment) return courier.api_config.environment;

  if (
    process.env.CONTEXT === 'production' ||
    process.env.NETLIFY_CONTEXT === 'production' ||
    process.env.NODE_ENV === 'production'
  ) {
    return 'live';
  }

  return 'sandbox';
}

// --------------------------------------------------
// AUTHENTICATE WITH FEZ (DB first, env var fallback)
// --------------------------------------------------
async function authenticateFez(environment) {
  console.log('🔍 Fetching Fez credentials from database...');
  console.log('🌍 Environment:', environment);

  const { data: courier, error } = await supabase
    .from('couriers')
    .select('api_user_id, api_password, api_base_url, api_config')
    .eq('code', 'fez')
    .eq('api_enabled', true)
    .eq('environment', environment)
    .single();

  let userId, password, baseUrl;

  if (courier && !error && courier.api_user_id && courier.api_password) {
    userId = courier.api_user_id;
    password = courier.api_password;
    baseUrl = courier.api_base_url;
    console.log('✅ Using Fez credentials from database');
  } else {
    userId = process.env.FEZ_USER_ID;
    password = process.env.FEZ_PASSWORD || process.env.FEZ_API_KEY;
    baseUrl = process.env.FEZ_API_BASE_URL;
    console.log('⚠️ DB lookup missed — falling back to env vars', { error: error?.message });
  }

  if (!userId || !password || !baseUrl) {
    throw new Error(`Fez credentials not available for ${environment}`);
  }

  console.log('🔐 Authenticating with Fez...', { userId, baseUrl });

  const response = await fetch(`${baseUrl}/user/authenticate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, password }),
  });

  const data = await response.json();
  console.log('🔑 Fez auth response status:', data.status);

  if (data.status !== 'Success') {
    throw new Error(data.description || 'Fez authentication failed');
  }

  return {
    authToken: data.authDetails.authToken,
    secretKey: data.orgDetails['secret-key'],
    baseUrl,
  };
}

// --------------------------------------------------
// FETCH TRACKING
// --------------------------------------------------
async function fetchFezTracking(authToken, secretKey, baseUrl, trackingNumber) {
  const response = await fetch(`${baseUrl}/order/track/${trackingNumber}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${authToken}`,
      'secret-key': secretKey,
    },
  });

  const data = await response.json();

  if (data.status !== 'Success') {
    throw new Error(data.description || 'Order Not Found');
  }

  return {
    order: data.order,
    history: data.history,
  };
}

// --------------------------------------------------
// STATUS MAPPING
// --------------------------------------------------
function mapFezStatus(status) {
  const map = {
    'Pending Pick-Up': 'pending_pickup',
    'Picked-Up': 'picked_up',
    Dispatched: 'in_transit',
    'Out for Delivery': 'out_for_delivery',
    Delivered: 'delivered',
    Cancelled: 'cancelled',
    Returned: 'returned',
  };

  return map[status] || 'processing';
}

function isValidFezTrackingNumber(val) {
  if (!val || typeof val !== 'string') return false;
  return !/^[0-9a-f-]{36}$/i.test(val); // exclude UUIDs
}

// --------------------------------------------------
// NETLIFY HANDLER
// --------------------------------------------------
export async function handler(event) {
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
    const subOrderId = event.queryStringParameters?.subOrderId;

    if (!subOrderId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'subOrderId required' }),
      };
    }

    const { data: subOrder, error } = await supabase
      .from('sub_orders')
      .select('*')
      .eq('id', subOrderId)
      .single();

    if (error || !subOrder) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ success: false, error: 'Sub-order not found' }),
      };
    }

    const trackingNumber =
      subOrder.courier_waybill || subOrder.tracking_number;

    if (!isValidFezTrackingNumber(trackingNumber)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'No valid Fez tracking number',
        }),
      };
    }

    // 🔐 Resolve environment SAFELY
    const environment = resolveEnvironment(subOrder);

    const { authToken, secretKey, baseUrl } =
      await authenticateFez(environment);

    const trackingData = await fetchFezTracking(
      authToken,
      secretKey,
      baseUrl,
      trackingNumber
    );

    const previousStatus = subOrder.status;
    const jloStatus = mapFezStatus(trackingData.order.orderStatus);
    const fezLabel = trackingData.order?.orderStatus || '';

    await supabase
      .from('sub_orders')
      .update({
        status: jloStatus,
        last_tracking_update: new Date().toISOString(),
      })
      .eq('id', subOrderId);

    if (previousStatus !== jloStatus && subOrder.main_order_id) {
      try {
        await refreshOverallOrderStatus(supabase, subOrder.main_order_id);
      } catch (e) {
        console.warn('refreshOverallOrderStatus (fez-fetch-tracking):', e?.message || e);
      }

      const { data: orderRow } = await supabase
        .from('orders')
        .select(
          'id, order_number, customer_name, customer_email, delivery_city, delivery_state',
        )
        .eq('id', subOrder.main_order_id)
        .maybeSingle();

      if (orderRow?.customer_email) {
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
          `https://web.fezdelivery.co/track-delivery?tracking=${encodeURIComponent(String(trackingNumber))}`;
        try {
          await sendApiCourierStatusCustomerEmail(supabase, {
            jloStatus,
            orderId: orderRow.id,
            orderNumber: orderRow.order_number ?? orderRow.id,
            customer_name: orderRow.customer_name,
            customer_email: orderRow.customer_email,
            tracking_number: trackingNumber,
            courier_tracking_url: fezTrackUrl,
            courier_display_name: courierDisplay,
            delivery_city: orderRow.delivery_city,
            delivery_state: orderRow.delivery_state,
            raw_status_hint: fezLabel,
          });
        } catch (mailErr) {
          console.error('sendApiCourierStatusCustomerEmail (fez-fetch-tracking):', mailErr?.message || mailErr);
        }
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        data: {
          status: jloStatus,
          fez_status: trackingData.order.orderStatus,
          tracking_number: trackingNumber,
          history: trackingData.history,
        },
      }),
    };
  } catch (err) {
    console.error('❌ Fez tracking error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Failed to fetch tracking',
        message: err.message,
      }),
    };
  }
}
