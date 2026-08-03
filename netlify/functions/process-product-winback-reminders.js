// Netlify scheduled function: win back customers who viewed a product 24-48h
// ago and never bought it. Runs hourly.
import { createClient } from '@supabase/supabase-js';
import { sendTransactionalEmail } from './services/emailNotifications.js';
import { isConsentedForEmail } from './services/notificationConsent.js';
import { makeUnsubscribeToken } from './services/unsubscribeToken.js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
const PWA_BASE_URL = process.env.PWA_BASE_URL || 'https://julinemart.com';
const JLO_URL = process.env.JLO_URL || 'https://jlo.julinemart.com';

const REMIND_AFTER_HOURS = 24;
const WINDOW_HOURS = 48;
const BATCH_SIZE = 100;

function unsubscribeUrl(email) {
  const token = makeUnsubscribeToken(email, 'promotions');
  return `${JLO_URL}/api/unsubscribe?email=${encodeURIComponent(email)}&category=promotions&token=${token}`;
}

export async function handler() {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('process-product-winback-reminders: missing Supabase credentials');
    return { statusCode: 500, body: 'Missing Supabase credentials' };
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const windowFrom = new Date(Date.now() - WINDOW_HOURS * 60 * 60 * 1000).toISOString();
  const windowUntil = new Date(Date.now() - REMIND_AFTER_HOURS * 60 * 60 * 1000).toISOString();

  const { data: views, error: fetchError } = await supabase
    .from('customer_journey_events')
    .select('customer_email, product_id, created_at')
    .eq('event_type', 'product_viewed')
    .not('customer_email', 'is', null)
    .not('product_id', 'is', null)
    .gte('created_at', windowFrom)
    .lte('created_at', windowUntil)
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE);

  if (fetchError) {
    console.error('process-product-winback-reminders: fetch failed', fetchError);
    return { statusCode: 500, body: fetchError.message };
  }

  if (!views?.length) {
    return { statusCode: 200, body: JSON.stringify({ processed: 0 }) };
  }

  // Distinct (customer_email, product_id) pairs — keep the earliest view.
  const pairs = new Map();
  for (const v of views) {
    const key = `${v.customer_email.toLowerCase()}::${v.product_id}`;
    if (!pairs.has(key)) pairs.set(key, v);
  }

  let sent = 0;
  let skipped = 0;

  for (const { customer_email: email, product_id: productId } of pairs.values()) {
    const { data: existingSend } = await supabase
      .from('product_winback_sends')
      .select('id')
      .eq('customer_email', email)
      .eq('product_id', productId)
      .maybeSingle();
    if (existingSend) continue;

    // Skip if already purchased. order_items.product_id is character varying
    // (legacy WooCommerce-compatible column), not uuid — compare as text.
    const { data: purchase } = await supabase
      .from('order_items')
      .select('id, orders!inner(payment_status, customer_email)')
      .eq('product_id', String(productId))
      .eq('orders.payment_status', 'paid')
      .ilike('orders.customer_email', email)
      .limit(1);

    if (purchase?.length) {
      await supabase.from('product_winback_sends').insert({ customer_email: email, product_id: productId });
      skipped += 1;
      continue;
    }

    const allowed = await isConsentedForEmail(supabase, { email, category: 'promotions' });
    if (!allowed) {
      await supabase.from('product_winback_sends').insert({ customer_email: email, product_id: productId });
      skipped += 1;
      continue;
    }

    const { data: product } = await supabase
      .from('products')
      .select('name, slug, regular_price, sale_price, product_images(src, is_thumbnail, position)')
      .eq('id', productId)
      .maybeSingle();

    if (!product) {
      await supabase.from('product_winback_sends').insert({ customer_email: email, product_id: productId });
      skipped += 1;
      continue;
    }

    const images = (product.product_images || []).slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    const thumbnail = images.find((img) => img.is_thumbnail) || images[0];
    const price = product.sale_price ?? product.regular_price ?? 0;

    try {
      const result = await sendTransactionalEmail({
        templateName: 'Product Win-Back',
        to: email,
        data: {
          customerName: 'there',
          productName: product.name,
          productImage: thumbnail?.src || '',
          productPrice: Number(price).toLocaleString(),
          productUrl: `${PWA_BASE_URL}/product/${product.slug}`,
          unsubscribeUrl: unsubscribeUrl(email),
        },
      });
      if (result.sent) sent += 1;
    } catch (error) {
      console.error('process-product-winback-reminders: send failed', email, productId, error);
    }

    await supabase.from('product_winback_sends').insert({ customer_email: email, product_id: productId });
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ processed: pairs.size, sent, skipped }),
  };
}
