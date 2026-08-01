// Netlify scheduled function: process due rows in scheduled_push_notifications.
import { createClient } from '@supabase/supabase-js';
import { sendPushViaPwa } from './services/pushSendProxy.js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
const PWA_BASE_URL = process.env.PWA_BASE_URL;
const NOTIFICATIONS_ADMIN_SECRET = process.env.NOTIFICATIONS_ADMIN_SECRET;

const BATCH_SIZE = 20;

const finalStatus = (result) => {
  if (result.partial) return 'partial';
  if (result.ok) return 'sent';
  return 'failed';
};

export async function handler() {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('process-scheduled-push: missing Supabase credentials');
    return { statusCode: 500, body: 'Missing Supabase credentials' };
  }
  if (!PWA_BASE_URL) {
    console.error('process-scheduled-push: PWA_BASE_URL not configured');
    return { statusCode: 500, body: 'PWA_BASE_URL not configured' };
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const now = new Date().toISOString();

  const { data: dueRows, error: fetchError } = await supabase
    .from('scheduled_push_notifications')
    .select('id, payload')
    .eq('status', 'pending')
    .lte('schedule_at', now)
    .order('schedule_at', { ascending: true })
    .limit(BATCH_SIZE);

  if (fetchError) {
    console.error('process-scheduled-push: fetch failed', fetchError);
    return { statusCode: 500, body: fetchError.message };
  }

  if (!dueRows?.length) {
    return { statusCode: 200, body: JSON.stringify({ processed: 0 }) };
  }

  let processed = 0;

  for (const row of dueRows) {
    const { error: lockError } = await supabase
      .from('scheduled_push_notifications')
      .update({ status: 'processing' })
      .eq('id', row.id)
      .eq('status', 'pending');

    if (lockError) {
      console.error('process-scheduled-push: lock failed', row.id, lockError);
      continue;
    }

    try {
      const result = await sendPushViaPwa({
        pwaBaseUrl: PWA_BASE_URL,
        notificationsAdminSecret: NOTIFICATIONS_ADMIN_SECRET,
        payload: row.payload,
      });

      const { error: updateError } = await supabase
        .from('scheduled_push_notifications')
        .update({
          status: finalStatus(result),
          result: result.body,
          processed_at: new Date().toISOString(),
        })
        .eq('id', row.id);

      if (updateError) {
        console.error('process-scheduled-push: update failed', row.id, updateError);
      } else {
        processed += 1;
      }
    } catch (error) {
      console.error('process-scheduled-push: send failed', row.id, error);
      await supabase
        .from('scheduled_push_notifications')
        .update({
          status: 'failed',
          result: { error: error instanceof Error ? error.message : 'Send failed' },
          processed_at: new Date().toISOString(),
        })
        .eq('id', row.id);
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ processed, fetched: dueRows.length }),
  };
}
