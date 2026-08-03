/**
 * GET /api/unsubscribe?email=&category=&token=
 *
 * Public, no auth — must work for guests with no dashboard/customer account.
 * Verifies an HMAC token, records the suppression, and returns a minimal
 * static HTML confirmation. Never reveals whether the email exists.
 */
import { createClient } from '@supabase/supabase-js';
import { verifyUnsubscribeToken } from './services/unsubscribeToken.js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const CATEGORY_LABELS = {
  order_updates: 'order update',
  promotions: 'promotional',
  newsletter: 'newsletter',
  all: 'all',
};

function htmlPage(title, message) {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} - JulineMart</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background:#f5f5f5; margin:0; padding:0; }
  .box { max-width: 480px; margin: 60px auto; background:#fff; border-radius:8px; padding:32px 24px; text-align:center; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  h1 { font-size: 18px; color:#1f2937; margin:0 0 8px; }
  p { font-size: 14px; color:#6b7280; margin:0; }
</style>
</head><body>
  <div class="box"><h1>${title}</h1><p>${message}</p></div>
</body></html>`,
  };
}

export async function handler(event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const { email, category, token } = event.queryStringParameters || {};

  if (!email || !category || !token || !verifyUnsubscribeToken(email, category, token)) {
    return htmlPage('Link invalid', 'This unsubscribe link is invalid or has expired.');
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return htmlPage('Unavailable', 'Something went wrong. Please try again later.');
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    await adminClient
      .from('email_suppressions')
      .upsert({ email: normalizedEmail, category }, { onConflict: 'email,category' });

    // Best-effort: also flip the matching preference if a real account exists.
    if (category !== 'all') {
      const { data: customer } = await adminClient
        .from('customers')
        .select('id')
        .ilike('email', normalizedEmail)
        .maybeSingle();
      if (customer) {
        await adminClient
          .from('customer_notification_prefs')
          .upsert({ customer_id: customer.id, [category]: false, updated_at: new Date().toISOString() });
      }
    }
  } catch (err) {
    console.error('unsubscribe error:', err);
    return htmlPage('Unavailable', 'Something went wrong. Please try again later.');
  }

  const label = CATEGORY_LABELS[category] || category;
  return htmlPage('Unsubscribed', `You've been unsubscribed from ${label} emails from JulineMart.`);
}
