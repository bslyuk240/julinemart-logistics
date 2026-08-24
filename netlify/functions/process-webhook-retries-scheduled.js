/**
 * Scheduled (every 5 min, see netlify.toml): retries 'pending'/'failed'
 * webhook_deliveries whose next_attempt_at has passed, with exponential
 * backoff. Reuses the row's original event_id on every retry — the
 * receiving end is expected to dedupe on X-Skola-Event-Id.
 */
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { decryptSecret } from './services/secretsCrypto.js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';
const supabase = createClient(supabaseUrl, serviceKey);

const MAX_ATTEMPTS = 6;
// Minutes to wait before each successive retry (index = attempts so far).
const BACKOFF_MINUTES = [1, 5, 15, 60, 180, 360];

function signBody(rawBody, secret) {
  return crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
}

export const handler = async () => {
  const { data: rows, error } = await supabase
    .from('webhook_deliveries')
    .select('id, webhook_endpoint_id, event_id, event_type, payload, attempts, webhook_endpoints ( id, url, secret_encrypted, is_active )')
    .in('status', ['pending', 'failed'])
    .lte('next_attempt_at', new Date().toISOString())
    .limit(100);

  if (error) {
    console.error('[process-webhook-retries] failed to load deliveries:', error.message);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }

  let succeeded = 0;
  let retried = 0;
  let dead = 0;

  for (const row of rows || []) {
    const endpoint = row.webhook_endpoints;
    if (!endpoint || !endpoint.is_active) {
      await supabase.from('webhook_deliveries').update({ status: 'dead', last_error: 'Endpoint removed or disabled' }).eq('id', row.id);
      dead += 1;
      continue;
    }

    const rawBody = JSON.stringify(row.payload);
    const attempts = row.attempts + 1;

    try {
      const secret = decryptSecret(endpoint.secret_encrypted);
      const signature = signBody(rawBody, secret);
      const response = await fetch(endpoint.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Skola-Event-Id': row.event_id,
          'X-Skola-Signature': signature,
        },
        body: rawBody,
      });

      if (!response.ok) throw new Error(`Endpoint responded ${response.status}`);

      await supabase
        .from('webhook_deliveries')
        .update({ status: 'success', attempts, last_attempt_at: new Date().toISOString(), last_error: null })
        .eq('id', row.id);
      succeeded += 1;
    } catch (err) {
      if (attempts >= MAX_ATTEMPTS) {
        await supabase
          .from('webhook_deliveries')
          .update({ status: 'dead', attempts, last_attempt_at: new Date().toISOString(), last_error: err.message })
          .eq('id', row.id);
        dead += 1;
        continue;
      }

      const delayMinutes = BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)];
      await supabase
        .from('webhook_deliveries')
        .update({
          status: 'failed',
          attempts,
          last_attempt_at: new Date().toISOString(),
          next_attempt_at: new Date(Date.now() + delayMinutes * 60_000).toISOString(),
          last_error: err.message,
        })
        .eq('id', row.id);
      retried += 1;
    }
  }

  return { statusCode: 200, body: JSON.stringify({ checked: (rows || []).length, succeeded, retried, dead }) };
};
