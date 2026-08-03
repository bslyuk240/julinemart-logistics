// Netlify scheduled function: remind customers who started checkout but
// never paid. Runs every 15 minutes; clones the poll/lock/send/mark shape
// of process-scheduled-push.js.
import { createClient } from '@supabase/supabase-js';
import { sendTransactionalEmail } from './services/emailNotifications.js';
import { isConsentedForEmail } from './services/notificationConsent.js';
import { makeUnsubscribeToken } from './services/unsubscribeToken.js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
const PWA_BASE_URL = process.env.PWA_BASE_URL || 'https://julinemart.com';
const JLO_URL = process.env.JLO_URL || 'https://jlo.julinemart.com';

const REMINDER_DELAY_MIN = 60; // remind 1h after checkout started
const GIVE_UP_HOURS = 48; // stop trying after 48h — order is effectively dead
const BATCH_SIZE = 50;

function unsubscribeUrl(email) {
  const token = makeUnsubscribeToken(email, 'order_updates');
  return `${JLO_URL}/api/unsubscribe?email=${encodeURIComponent(email)}&category=order_updates&token=${token}`;
}

export async function handler() {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('process-abandoned-checkout-reminders: missing Supabase credentials');
    return { statusCode: 500, body: 'Missing Supabase credentials' };
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const remindFrom = new Date(Date.now() - GIVE_UP_HOURS * 60 * 60 * 1000).toISOString();
  const remindUntil = new Date(Date.now() - REMINDER_DELAY_MIN * 60 * 1000).toISOString();

  const { data: candidates, error: fetchError } = await supabase
    .from('orders')
    .select('id, order_number, customer_name, customer_email, total_amount, created_at')
    .eq('payment_status', 'pending')
    .is('abandoned_reminder_sent_at', null)
    .gte('created_at', remindFrom)
    .lte('created_at', remindUntil)
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE);

  if (fetchError) {
    console.error('process-abandoned-checkout-reminders: fetch failed', fetchError);
    return { statusCode: 500, body: fetchError.message };
  }

  if (!candidates?.length) {
    return { statusCode: 200, body: JSON.stringify({ processed: 0 }) };
  }

  let sent = 0;
  let skipped = 0;

  for (const order of candidates) {
    if (!order.customer_email) {
      // No email on file — nothing we can do, mark handled so it's not
      // re-checked every run.
      await supabase.from('orders').update({ abandoned_reminder_sent_at: new Date().toISOString() }).eq('id', order.id);
      skipped += 1;
      continue;
    }

    const allowed = await isConsentedForEmail(supabase, { email: order.customer_email, category: 'order_updates' });
    if (!allowed) {
      await supabase.from('orders').update({ abandoned_reminder_sent_at: new Date().toISOString() }).eq('id', order.id);
      skipped += 1;
      continue;
    }

    try {
      const result = await sendTransactionalEmail({
        templateName: 'Abandoned Checkout Reminder',
        to: order.customer_email,
        orderId: order.id,
        data: {
          customerName: order.customer_name || 'there',
          orderNumber: order.order_number,
          totalAmount: Number(order.total_amount || 0).toLocaleString(),
          cartUrl: `${PWA_BASE_URL}/cart`,
          unsubscribeUrl: unsubscribeUrl(order.customer_email),
        },
      });
      if (result.sent) sent += 1;
    } catch (error) {
      // sendTransactionalEmail already logs+swallows its own errors, but
      // guard here too so one bad row can't stop the batch.
      console.error('process-abandoned-checkout-reminders: send failed', order.id, error);
    }

    // Mark handled regardless of outcome (sent / no_template / disabled /
    // duplicate) — this only sends an email, never mutates money-relevant
    // state, so a redundant email for a customer who paid seconds before
    // this ran is an acceptable edge case rather than something worth a
    // race-guard.
    await supabase.from('orders').update({ abandoned_reminder_sent_at: new Date().toISOString() }).eq('id', order.id);
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ processed: candidates.length, sent, skipped }),
  };
}
