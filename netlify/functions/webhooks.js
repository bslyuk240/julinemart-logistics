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
    const parseBody = (body) => {
      if (typeof body !== 'string') return body || {};
      try {
        return JSON.parse(body);
      } catch {
        const params = new URLSearchParams(body);
        const result = {};
        for (const [key, value] of params) {
          result[key] = value;
        }
        return result;
      }
    };

    const payload = parseBody(event.body);

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

    const lineItems = Array.isArray(payload?.line_items) ? payload.line_items : [];
    if (lineItems.length > 0) {
      const orderItemsData = lineItems.map((item) => {
        const unit = Number(item?.price || 0);
        const qty = Number(item?.quantity || 1);
        const vendorId = String(item?.meta_data?.find((m) => m.key === 'vendor_id')?.value ?? 'default');
        const hubId = String(item?.meta_data?.find((m) => m.key === 'hub_id')?.value ?? 'default');
        return {
          product_id: String(item?.product_id ?? ''),
          product_name: String(item?.name ?? ''),
          product_sku: item?.sku ? String(item.sku) : null,
          unit_price: unit,
          quantity: qty,
          subtotal: Number((unit * qty).toFixed(2)),
          vendor_id: vendorId,
          hub_id: hubId,
          order_id: order.id,
        };
      });
      await supabase.from('order_items').insert(orderItemsData);
    }

    // Auto-create sub-orders and courier assignments
    await ensureSubOrdersAndAssignments(order.id, lineItems, shippingTotal);

    // Optionally insert order_items for visibility
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: 'Order received', order_id: order.id }) };
  } catch (e) {
    console.error('Webhook error:', e);
    // Reply 200 to prevent repeated retries, but include message
    return { statusCode: 200, headers, body: JSON.stringify({ success: false, message: 'Received but not processed' }) };
  }
}

async function ensureSubOrdersAndAssignments(orderId, lineItems, shippingTotal) {
  if (!lineItems.length) return;

  const groupKey = (item) => {
    const vendorId = String(item?.meta_data?.find((m) => m.key === 'vendor_id')?.value ?? 'default');
    const hubId = String(item?.meta_data?.find((m) => m.key === 'hub_id')?.value ?? 'default');
    return `${hubId}::${vendorId}`;
  };

  const subOrderGroups = new Map();
  for (const item of lineItems) {
    const vendorId = String(item?.meta_data?.find((m) => m.key === 'vendor_id')?.value ?? 'default');
    const hubId = String(item?.meta_data?.find((m) => m.key === 'hub_id')?.value ?? 'default');
    const key = `${hubId}::${vendorId}`;
    const product = {
      product_id: String(item?.product_id ?? ''),
      product_name: String(item?.name ?? ''),
      product_sku: item?.sku ? String(item.sku) : null,
      unit_price: Number(item?.price || 0),
      quantity: Number(item?.quantity || 1),
      subtotal: Number((Number(item?.price || 0) * Number(item?.quantity || 1)).toFixed(2)),
      vendor_id: vendorId,
      hub_id: hubId,
    };

    if (!subOrderGroups.has(key)) {
      subOrderGroups.set(key, {
        hubId,
        vendorId,
        items: [],
        subtotal: 0,
      });
    }

    const subOrder = subOrderGroups.get(key);
    subOrder.items.push(product);
    subOrder.subtotal += product.subtotal;
  }

  const shippingPerSubOrder = shippingTotal / Math.max(1, subOrderGroups.size);

  for (const subOrder of subOrderGroups.values()) {
    const { data: createdSubOrder, error: subOrderError } = await supabase
      .from('sub_orders')
      .insert({
        main_order_id: orderId,
        hub_id: subOrder.hubId,
        vendor_id: subOrder.vendorId,
        items: subOrder.items,
        subtotal: subOrder.subtotal,
        allocated_shipping_fee: shippingPerSubOrder,
        status: 'pending',
      })
      .select()
      .single();

    if (subOrderError || !createdSubOrder) {
      console.error('Failed to create sub-order', subOrderError);
      continue;
    }

    const orderItems = subOrder.items.map((product) => ({
      ...product,
      order_id: orderId,
      sub_order_id: createdSubOrder.id,
    }));

    await supabase.from('order_items').insert(orderItems);

    await assignCourierToSubOrder(createdSubOrder.id, subOrder.hubId);
  }
}

async function assignCourierToSubOrder(subOrderId, hubId) {
  if (!hubId) return;
  try {
    const { data: hubCourier } = await supabase
      .from('hub_couriers')
      .select(`
        courier_id,
        is_primary,
        priority,
        couriers (
          id,
          name
        )
      `)
      .eq('hub_id', hubId)
      .filter('couriers.is_active', 'eq', true)
      .order('is_primary', { ascending: false })
      .order('priority', { ascending: false })
      .limit(1)
      .single();

    if (!hubCourier) return;

    const { data: updatedSubOrder, error } = await supabase
      .from('sub_orders')
      .update({
        courier_id: hubCourier.courier_id,
        status: 'assigned',
      })
      .eq('id', subOrderId)
      .select()
      .single();

    if (error) {
      throw error;
    }

    await supabase.from('tracking_events').insert({
      sub_order_id: subOrderId,
      status: 'assigned',
      description: `Assigned to ${hubCourier.couriers?.name || 'courier'}`,
      actor_type: 'system',
      source: 'webhook',
    });
    return updatedSubOrder;
  } catch (error) {
    console.error('Failed to assign courier', error);
  }
}
