// Netlify Function: /api/webhooks/* (WooCommerce)
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL || '', SERVICE_KEY || '');

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function verifyWooSignature(rawBody, signature, secret) {
  try {
    const digest = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
    return digest === signature;
  } catch {
    return false;
  }
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // Route parsing: expect /api/webhooks/woocommerce
  const parts = event.path.split('/');
  const idx = parts.findIndex((p) => p === 'webhooks');
  const sub = idx >= 0 && parts.length > idx + 1 ? parts[idx + 1] : undefined; // 'woocommerce'

  if (event.httpMethod !== 'POST' || sub !== 'woocommerce') {
    return { statusCode: 404, headers, body: JSON.stringify({ success: false, error: 'Not Found' }) };
  }

  try {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      console.error('Webhooks function misconfigured: missing Supabase env');
      // Still acknowledge to avoid repeated retries; but note misconfig
      return { statusCode: 202, headers, body: JSON.stringify({ success: false, message: 'Accepted (server not configured)' }) };
    }

    // Verify WooCommerce signature if provided
    const secret = process.env.WEBHOOK_SECRET || '';
    const signature = (event.headers['x-wc-webhook-signature'] || event.headers['X-WC-Webhook-Signature'] || '').toString();
    if (secret && signature) {
      const ok = verifyWooSignature(event.body || '', signature, secret);
      if (!ok) {
        return { statusCode: 401, headers, body: JSON.stringify({ success: false, error: 'Invalid webhook signature' }) };
      }
    }

    // Parse payload
    const payload = typeof event.body === 'string' ? JSON.parse(event.body) : (event.body || {});

    // Minimal field mapping from Woo payload
    const wooId = String(payload?.id ?? '');
    const billing = payload?.billing || {};
    const shipping = payload?.shipping || {};
    const total = Number(payload?.total || 0);
    const shippingTotal = Number(payload?.shipping_total || 0);
    const subtotal = Number((total - shippingTotal).toFixed(2));

    if (!wooId) {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Missing order id' }) };
    }

    // Determine zone by state, if available
    let deliveryZone = 'NC';
    try {
      if (shipping?.state) {
        const { data: zones } = await supabase.from('zones').select('code, states');
        const found = (zones || []).find((z) => Array.isArray(z.states) && z.states.includes(shipping.state));
        if (found?.code) deliveryZone = found.code;
      }
    } catch {}

    // Insert or upsert the order
    const orderInsert = {
      woocommerce_order_id: wooId,
      customer_name: `${billing.first_name || ''} ${billing.last_name || ''}`.trim() || 'Customer',
      customer_email: billing.email || 'unknown@example.com',
      customer_phone: billing.phone || 'N/A',
      delivery_address: shipping.address_1 || 'Address',
      delivery_city: shipping.city || 'City',
      delivery_state: shipping.state || 'State',
      delivery_zone: deliveryZone,
      subtotal,
      total_amount: total,
      shipping_fee_paid: shippingTotal,
      payment_status: 'pending',
      overall_status: 'pending'
    };

    // Upsert by unique woocommerce_order_id
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .upsert(orderInsert, { onConflict: 'woocommerce_order_id' })
      .select()
      .single();

    if (orderError) throw orderError;

    // Optionally insert order_items for visibility
    const lineItems = Array.isArray(payload?.line_items) ? payload.line_items : [];
    if (lineItems.length > 0) {
      const items = lineItems.map((item) => {
        const unit = Number(item?.price || 0);
        const qty = Number(item?.quantity || 1);
        return {
          order_id: order.id,
          product_id: String(item?.product_id ?? ''),
          product_name: String(item?.name ?? ''),
          product_sku: item?.sku ? String(item.sku) : null,
          unit_price: unit,
          quantity: qty,
          subtotal: Number((unit * qty).toFixed(2))
        };
      });
      // Ignore failures here to avoid failing webhook delivery
      await supabase.from('order_items').insert(items);
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: 'Order received', order_id: order.id }) };
  } catch (e) {
    console.error('Webhook error:', e);
    // Reply 200 to prevent repeated retries, but include message
    return { statusCode: 200, headers, body: JSON.stringify({ success: false, message: 'Received but not processed' }) };
  }
}

