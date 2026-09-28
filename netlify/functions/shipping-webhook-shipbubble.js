import { createClient } from '@supabase/supabase-js';
import { insertTrackingEvent } from './services/fezTracking.js';
import { refreshOverallOrderStatus } from './helpers/orderStatusHelper.js';
import { shipbubbleProvider } from './services/shipping/providers/shipbubbleProvider.js';
import { checkRateLimit } from './services/rate-limit.js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY,
);

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, x-ship-signature',
  'Content-Type': 'application/json',
};

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
  }

  const { limited, response } = await checkRateLimit(event, {
    name: 'shipbubble-webhook',
    max: 60,
    window: '1 m',
    retryAfterSeconds: 60,
  });
  if (limited) return response;

  if (!shipbubbleProvider.verifyWebhook(event)) {
    return { statusCode: 401, headers, body: JSON.stringify({ success: false, error: 'Invalid signature' }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Invalid JSON' }) };
  }

  const eventName = payload.event || '';
  if (eventName.startsWith('wallet.')) {
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, ignored: true }) };
  }

  const orderId = payload.order_id || payload.data?.order_id;
  const rawStatus = payload.status || payload.package_status?.[0]?.status || payload.data?.status;
  const jloStatus = shipbubbleProvider.mapStatus(rawStatus);
  if (!orderId || !jloStatus) {
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, ignored: true }) };
  }

  const { data: subOrder } = await supabase
    .from('sub_orders')
    .select('id, order_id, status, courier_shipment_id, provider_metadata')
    .eq('courier_shipment_id', orderId)
    .maybeSingle();

  if (!subOrder) {
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, ignored: true }) };
  }

  if (subOrder.status === jloStatus) {
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, idempotent: true }) };
  }

  const { data: existing } = await supabase
    .from('tracking_events')
    .select('id')
    .eq('sub_order_id', subOrder.id)
    .eq('source', 'webhook')
    .eq('source_reference', `${orderId}:${jloStatus}`)
    .maybeSingle();

  if (existing?.id) {
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, idempotent: true }) };
  }

  await supabase
    .from('sub_orders')
    .update({
      status: jloStatus,
      last_tracking_update: new Date().toISOString(),
      provider_metadata: {
        ...(subOrder.provider_metadata || {}),
        shipbubble: {
          ...((subOrder.provider_metadata || {}).shipbubble || {}),
          last_event: eventName,
          last_provider_status: rawStatus,
        },
      },
    })
    .eq('id', subOrder.id);

  await insertTrackingEvent(supabase, {
    sub_order_id: subOrder.id,
    status: jloStatus,
    description: payload.courier?.tracking_message || rawStatus || `Status: ${jloStatus}`,
    event_time: payload.date || new Date().toISOString(),
    source: 'webhook',
    source_reference: `${orderId}:${jloStatus}`,
    metadata: { provider: 'shipbubble', event: eventName, raw: payload },
  });

  if (subOrder.order_id) {
    await refreshOverallOrderStatus(subOrder.order_id);
  }

  return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
};
