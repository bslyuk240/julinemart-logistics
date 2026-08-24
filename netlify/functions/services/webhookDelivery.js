/**
 * Outbound webhook delivery to external systems (e.g. Skola Workforce).
 * sendWebhookEvent() fires immediately to every active, subscribed
 * webhook_endpoints row; on failure (or non-2xx) it leaves a 'pending' row in
 * webhook_deliveries for process-webhook-retries-scheduled.js to retry with
 * backoff. The same event_id is reused across retries — X-Skola-Event-Id —
 * so re-delivery is expected to be a no-op on the receiving end.
 */
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { decryptSecret } from './secretsCrypto.js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';

let adminClient = null;
function getAdmin() {
  if (!adminClient && supabaseUrl && serviceKey) {
    adminClient = createClient(supabaseUrl, serviceKey);
  }
  return adminClient;
}

function signBody(rawBody, secret) {
  return crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
}

async function deliverOnce(endpoint, rawBody, eventId) {
  const secret = decryptSecret(endpoint.secret_encrypted);
  const signature = signBody(rawBody, secret);

  const response = await fetch(endpoint.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Skola-Event-Id': eventId,
      'X-Skola-Signature': signature,
    },
    body: rawBody,
  });

  if (!response.ok) {
    throw new Error(`Webhook endpoint responded ${response.status}`);
  }
}

/**
 * @param {string} eventType - e.g. 'shipment.delayed', 'order.updated'
 * @param {object} data - event payload, becomes body.data
 */
export async function sendWebhookEvent(eventType, data) {
  const client = getAdmin();
  if (!client) {
    console.warn('[webhookDelivery] missing Supabase config, skipping', eventType);
    return;
  }

  const { data: endpoints, error } = await client
    .from('webhook_endpoints')
    .select('id, url, secret_encrypted, event_types')
    .eq('is_active', true);

  if (error) {
    console.error('[webhookDelivery] failed to load endpoints:', error.message);
    return;
  }

  const subscribed = (endpoints || []).filter(
    (ep) => !ep.event_types?.length || ep.event_types.includes(eventType)
  );
  if (subscribed.length === 0) return;

  const eventId = crypto.randomUUID();
  const rawBody = JSON.stringify({ event_type: eventType, data });

  for (const endpoint of subscribed) {
    try {
      await deliverOnce(endpoint, rawBody, eventId);
      await client.from('webhook_deliveries').insert({
        webhook_endpoint_id: endpoint.id,
        event_id: eventId,
        event_type: eventType,
        payload: { event_type: eventType, data },
        status: 'success',
        attempts: 1,
        last_attempt_at: new Date().toISOString(),
      });
    } catch (err) {
      console.warn(`[webhookDelivery] delivery failed for ${endpoint.id}, will retry:`, err.message);
      await client.from('webhook_deliveries').insert({
        webhook_endpoint_id: endpoint.id,
        event_id: eventId,
        event_type: eventType,
        payload: { event_type: eventType, data },
        status: 'pending',
        attempts: 1,
        last_attempt_at: new Date().toISOString(),
        next_attempt_at: new Date(Date.now() + 60_000).toISOString(),
        last_error: err.message,
      });
    }
  }
}
