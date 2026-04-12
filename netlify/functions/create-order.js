/**
 * POST /api/create-order
 *
 * Public endpoint — no authentication required (customers place orders).
 * Creates an order in Supabase, grouped into sub-orders by vendor.
 * Returns the order ID and a Paystack-compatible payment reference.
 *
 * Body:
 *   customer_name, customer_email, customer_phone   (required)
 *   delivery_address, delivery_city, delivery_state, delivery_zone  (required)
 *   delivery_lga, delivery_landmark  (optional)
 *   items: [{ product_id, variation_id?, quantity }]  (required, min 1)
 *   shipping_fee: number  (required, ₦)
 *   voucher_code?: string
 *   special_instructions?: string
 *   order_notes?: string
 */

import nodemailer from 'nodemailer';
import { headers, jsonResponse, adminClient } from './services/global-sourcing-utils.js';
import { decryptEmailConfigSecrets } from '../../shared/emailSecretsCrypto.js';

async function sendOrderEmails(supabase, { orderNumber, customer_name, customer_email, customer_phone, delivery_address, delivery_city, delivery_state, subtotal, discountAmount, shippingFee, totalAmount, resolvedItems }) {
  try {
    const { data: rawCfg } = await supabase.from('email_config').select('*').single();
    const cfg = rawCfg ? decryptEmailConfigSecrets(rawCfg) : null;
    if (!cfg?.email_enabled) return;

    let transportConfig;
    let from;
    if (cfg.provider === 'gmail') {
      transportConfig = { service: 'gmail', auth: { user: cfg.gmail_user, pass: cfg.gmail_password } };
      from = cfg.email_from || cfg.gmail_user;
    } else if (cfg.provider === 'sendgrid') {
      transportConfig = { host: 'smtp.sendgrid.net', port: 587, auth: { user: 'apikey', pass: cfg.sendgrid_api_key } };
      from = cfg.email_from;
    } else {
      const port = cfg.smtp_port || 587;
      const secure = port === 465;
      transportConfig = {
        host: cfg.smtp_host,
        port,
        secure,
        auth: { user: cfg.smtp_user, pass: cfg.smtp_password },
        ...(!secure ? { requireTLS: true } : {}),
      };
      from = cfg.email_from || cfg.smtp_user;
    }
    if (!from) return;

    const transporter = nodemailer.createTransport(transportConfig);
    const fmt = (n) => `₦${Number(n).toLocaleString()}`;

    const itemRows = resolvedItems.map((i) =>
      `<tr><td style="padding:6px 12px;border-bottom:1px solid #f3f3f3">${i.product_name}${i.variation_details?.attributes?.length ? ' (' + i.variation_details.attributes.map(a => `${a.name}: ${a.option}`).join(', ') + ')' : ''}</td><td style="padding:6px 12px;border-bottom:1px solid #f3f3f3;text-align:center">${i.quantity}</td><td style="padding:6px 12px;border-bottom:1px solid #f3f3f3;text-align:right">${fmt(i.subtotal)}</td></tr>`
    ).join('');

    const customerHtml = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
  <div style="background:#6b21a8;color:#fff;padding:30px;text-align:center">
    <h1 style="margin:0;font-size:24px">Order Confirmed! 🎉</h1>
    <p style="margin:8px 0 0;opacity:.85">Order #${orderNumber}</p>
  </div>
  <div style="padding:30px;background:#fff">
    <p>Hi ${customer_name},</p>
    <p>Thank you for shopping with JulineMart! Your order has been received and is being processed.</p>
    <table style="width:100%;border-collapse:collapse;margin:20px 0">
      <thead><tr style="background:#f9f9f9"><th style="padding:8px 12px;text-align:left">Item</th><th style="padding:8px 12px;text-align:center">Qty</th><th style="padding:8px 12px;text-align:right">Total</th></tr></thead>
      <tbody>${itemRows}</tbody>
    </table>
    <table style="width:100%;border-collapse:collapse">
      <tr><td style="padding:4px 0;color:#666">Subtotal</td><td style="padding:4px 0;text-align:right">${fmt(subtotal)}</td></tr>
      ${discountAmount > 0 ? `<tr><td style="padding:4px 0;color:#16a34a">Discount</td><td style="padding:4px 0;text-align:right;color:#16a34a">-${fmt(discountAmount)}</td></tr>` : ''}
      <tr><td style="padding:4px 0;color:#666">Shipping</td><td style="padding:4px 0;text-align:right">${fmt(shippingFee)}</td></tr>
      <tr style="font-weight:bold;font-size:16px;border-top:2px solid #e5e7eb"><td style="padding:8px 0">Total</td><td style="padding:8px 0;text-align:right;color:#6b21a8">${fmt(totalAmount)}</td></tr>
    </table>
    <div style="margin-top:20px;padding:16px;background:#f9f9f9;border-radius:8px">
      <p style="margin:0 0 4px;font-weight:bold">Delivery Address</p>
      <p style="margin:0;color:#555">${delivery_address}, ${delivery_city}, ${delivery_state}</p>
    </div>
    <p style="margin-top:20px">We'll send you a tracking number once your order ships. You can also track your order at <a href="https://jlo.julinemart.com/customer" style="color:#6b21a8">jlo.julinemart.com</a>.</p>
  </div>
  <div style="background:#f3f4f6;padding:16px;text-align:center;font-size:12px;color:#666">
    <p>JulineMart — Your One-Stop Marketplace</p>
  </div>
</div>`;

    await transporter.sendMail({ from, to: customer_email, subject: `Order #${orderNumber} Confirmed - JulineMart`, html: customerHtml });

    // Vendor notifications — group items by vendor
    const vendorItemMap = new Map();
    for (const item of resolvedItems) {
      if (!item.vendor_id) continue;
      if (!vendorItemMap.has(item.vendor_id)) vendorItemMap.set(item.vendor_id, []);
      vendorItemMap.get(item.vendor_id).push(item);
    }

    if (vendorItemMap.size > 0) {
      const vendorIds = [...vendorItemMap.keys()];
      const { data: vendors } = await supabase.from('vendors').select('id, email, store_name, display_name').in('id', vendorIds);
      for (const vendor of (vendors || [])) {
        if (!vendor.email) continue;
        const vItems = vendorItemMap.get(vendor.id) || [];
        const vRows = vItems.map((i) =>
          `<tr><td style="padding:6px 12px;border-bottom:1px solid #f3f3f3">${i.product_name}</td><td style="padding:6px 12px;border-bottom:1px solid #f3f3f3;text-align:center">${i.quantity}</td><td style="padding:6px 12px;border-bottom:1px solid #f3f3f3;text-align:right">${fmt(i.subtotal)}</td></tr>`
        ).join('');
        const vendorHtml = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
  <div style="background:#6b21a8;color:#fff;padding:30px;text-align:center">
    <h1 style="margin:0;font-size:22px">New Order Received 📦</h1>
    <p style="margin:8px 0 0;opacity:.85">Order #${orderNumber}</p>
  </div>
  <div style="padding:30px;background:#fff">
    <p>Hi ${vendor.store_name || vendor.display_name || 'Vendor'},</p>
    <p>You have a new order from JulineMart. Please prepare the following items:</p>
    <table style="width:100%;border-collapse:collapse;margin:20px 0">
      <thead><tr style="background:#f9f9f9"><th style="padding:8px 12px;text-align:left">Item</th><th style="padding:8px 12px;text-align:center">Qty</th><th style="padding:8px 12px;text-align:right">Total</th></tr></thead>
      <tbody>${vRows}</tbody>
    </table>
    <div style="padding:16px;background:#fef9c3;border-radius:8px;margin-top:16px">
      <p style="margin:0;font-weight:bold">Delivery to: ${delivery_city}, ${delivery_state}</p>
      <p style="margin:4px 0 0;font-size:13px;color:#555">Please pack items and mark ready-to-ship on the JLO portal.</p>
    </div>
    <p style="margin-top:20px">Log in to <a href="https://jlo.julinemart.com" style="color:#6b21a8">JLO Portal</a> to process this order.</p>
  </div>
</div>`;
        await transporter.sendMail({ from, to: vendor.email, subject: `New Order #${orderNumber} - Action Required`, html: vendorHtml });
      }
    }
  } catch (err) {
    console.error('sendOrderEmails failed:', err?.message || err);
  }
}

function generateRef() {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `JLO-${ts}-${rand}`;
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });
  if (!adminClient) return jsonResponse(503, { error: 'Database not configured' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return jsonResponse(400, { error: 'Invalid JSON body' }); }

  const {
    customer_name,
    customer_email,
    customer_phone,
    delivery_address,
    delivery_city,
    delivery_state,
    delivery_zone,
    delivery_lga,
    delivery_landmark,
    items = [],
    shipping_fee = 0,
    voucher_code,
    special_instructions,
    order_notes,
  } = body;

  // ── Validate required fields ──────────────────────────────────────────────
  const missing = [];
  if (!customer_name?.trim()) missing.push('customer_name');
  if (!customer_email?.trim()) missing.push('customer_email');
  if (!customer_phone?.trim()) missing.push('customer_phone');
  if (!delivery_address?.trim()) missing.push('delivery_address');
  if (!delivery_city?.trim()) missing.push('delivery_city');
  if (!delivery_state?.trim()) missing.push('delivery_state');
  if (!delivery_zone?.trim()) missing.push('delivery_zone');
  if (!Array.isArray(items) || items.length === 0) missing.push('items');
  if (missing.length > 0) {
    return jsonResponse(400, { error: `Missing required fields: ${missing.join(', ')}` });
  }

  for (const item of items) {
    if (!item.product_id) return jsonResponse(400, { error: 'Each item must have a product_id' });
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      return jsonResponse(400, { error: 'Each item must have a quantity >= 1' });
    }
  }

  try {
    // ── Resolve products and prices ─────────────────────────────────────────
    const productIds = [...new Set(items.map((i) => i.product_id))];
    const variationIds = [...new Set(items.map((i) => i.variation_id).filter(Boolean))];

    // Separate UUIDs from WooCommerce numeric IDs (items added from listing page
    // via WooCommerce fallback won't have Supabase UUIDs)
    const isUuid = (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id));
    const productUuids = productIds.filter(isUuid);
    const productWooIds = productIds.filter((id) => !isUuid(id) && Number(id) > 0).map(Number);
    const variationUuids = variationIds.filter(isUuid);
    const variationWooIds = variationIds.filter((id) => !isUuid(id) && Number(id) > 0).map(Number);

    const productSelect = 'id, woo_product_id, name, slug, sku, regular_price, sale_price, stock_status, vendor_id, hub_id, type';
    const variationSelect = 'id, woo_variation_id, product_id, sku, regular_price, sale_price, stock_status, attributes, vendor_id, hub_id';

    const [
      { data: productsByUuid },
      { data: productsByWoo },
      { data: variationsByUuid },
      { data: variationsByWoo },
    ] = await Promise.all([
      productUuids.length > 0
        ? adminClient.from('products').select(productSelect).in('id', productUuids)
        : Promise.resolve({ data: [] }),
      productWooIds.length > 0
        ? adminClient.from('products').select(productSelect).in('woo_product_id', productWooIds)
        : Promise.resolve({ data: [] }),
      variationUuids.length > 0
        ? adminClient.from('product_variations').select(variationSelect).in('id', variationUuids)
        : Promise.resolve({ data: [] }),
      variationWooIds.length > 0
        ? adminClient.from('product_variations').select(variationSelect).in('woo_variation_id', variationWooIds)
        : Promise.resolve({ data: [] }),
    ]);

    // Build lookup maps: keyed by UUID and by WC numeric id
    const productMap = new Map();
    for (const p of [...(productsByUuid || []), ...(productsByWoo || [])]) {
      productMap.set(p.id, p);
      if (p.woo_product_id) productMap.set(String(p.woo_product_id), p);
    }
    const variationMap = new Map();
    for (const v of [...(variationsByUuid || []), ...(variationsByWoo || [])]) {
      variationMap.set(v.id, v);
      if (v.woo_variation_id) variationMap.set(String(v.woo_variation_id), v);
    }

    // ── Build resolved line items ───────────────────────────────────────────
    const resolvedItems = [];
    for (const item of items) {
      const product = productMap.get(item.product_id) || productMap.get(String(item.product_id));
      if (!product) return jsonResponse(404, { error: `Product not found: ${item.product_id}` });

      const variation = item.variation_id
        ? (variationMap.get(item.variation_id) || variationMap.get(String(item.variation_id)))
        : null;
      if (item.variation_id && !variation) {
        return jsonResponse(404, { error: `Variation not found: ${item.variation_id}` });
      }

      // Use sale_price if set, else regular_price; variation price takes precedence
      let source = variation || product;
      let unitPrice = Number(source.sale_price || source.regular_price || 0);

      // Variable products have null price on the parent; price lives on variations.
      // If no variation resolved (e.g. cart persisted with id=0 before a fix), fall
      // back to the cheapest active variation so the order isn't rejected.
      if (unitPrice <= 0 && product.type === 'variable' && !variation) {
        const { data: fallbackVars } = await adminClient
          .from('product_variations')
          .select('id, regular_price, sale_price, sku, vendor_id, hub_id')
          .eq('product_id', product.id)
          .eq('is_active', true)
          .order('regular_price', { ascending: true })
          .limit(1);
        const fallback = fallbackVars?.[0];
        if (fallback) {
          source = fallback;
          unitPrice = Number(fallback.sale_price || fallback.regular_price || 0);
        }
      }

      if (unitPrice <= 0) {
        return jsonResponse(400, { error: `Product "${product.name}" has no price set` });
      }

      // source may be the resolved variation, fallback variation, or product
      const effectiveVariation = variation || (source !== product ? source : null);
      resolvedItems.push({
        product_id: product.id,
        product_name: product.name,
        product_sku: effectiveVariation?.sku || product.sku || null,
        variation_id: effectiveVariation?.id || null,
        variation_details: effectiveVariation ? { attributes: effectiveVariation.attributes || [] } : null,
        vendor_id: effectiveVariation?.vendor_id || product.vendor_id || null,
        hub_id: effectiveVariation?.hub_id || product.hub_id || null,
        unit_price: unitPrice,
        quantity: item.quantity,
        subtotal: unitPrice * item.quantity,
        // for sub_order items JSONB
        _name: product.name,
        _sku: effectiveVariation?.sku || product.sku || null,
        _vendorId: effectiveVariation?.vendor_id || product.vendor_id || null,
        _hubId: effectiveVariation?.hub_id || product.hub_id || null,
        _variationAttributes: effectiveVariation?.attributes || [],
      });
    }

    // ── Voucher check ──────────────────────────────────────────────────────
    let discountAmount = 0;
    let voucherRow = null;
    if (voucher_code?.trim()) {
      const { data: voucher } = await adminClient
        .from('campaign_vouchers')
        .select('id, code, discount_type, discount_value, min_order_amount, max_uses, current_uses, expires_at, is_active')
        .eq('code', voucher_code.trim().toUpperCase())
        .eq('is_active', true)
        .maybeSingle();

      if (!voucher) return jsonResponse(400, { error: 'Invalid or expired voucher code' });
      if (voucher.expires_at && new Date(voucher.expires_at) < new Date()) {
        return jsonResponse(400, { error: 'Voucher has expired' });
      }
      if (voucher.max_uses != null && voucher.current_uses >= voucher.max_uses) {
        return jsonResponse(400, { error: 'Voucher has reached its usage limit' });
      }

      const rawSubtotal = resolvedItems.reduce((s, i) => s + i.subtotal, 0);
      if (voucher.min_order_amount && rawSubtotal < Number(voucher.min_order_amount)) {
        return jsonResponse(400, {
          error: `Minimum order amount for this voucher is ₦${Number(voucher.min_order_amount).toLocaleString()}`,
        });
      }

      discountAmount = voucher.discount_type === 'percentage'
        ? Math.round((rawSubtotal * Number(voucher.discount_value)) / 100)
        : Math.min(Number(voucher.discount_value), rawSubtotal);

      voucherRow = voucher;
    }

    // ── Totals ─────────────────────────────────────────────────────────────
    const subtotal = resolvedItems.reduce((s, i) => s + i.subtotal, 0);
    const shippingFee = Math.max(Number(shipping_fee) || 0, 0);
    const totalAmount = Math.max(subtotal - discountAmount + shippingFee, 0);
    const paymentReference = generateRef();

    // ── Insert order ───────────────────────────────────────────────────────
    const { data: order, error: orderErr } = await adminClient
      .from('orders')
      .insert({
        // order_number is auto-assigned by DB trigger
        customer_name: customer_name.trim(),
        customer_email: customer_email.trim().toLowerCase(),
        customer_phone: customer_phone.trim(),
        delivery_address: delivery_address.trim(),
        delivery_city: delivery_city.trim(),
        delivery_state: delivery_state.trim(),
        delivery_zone: delivery_zone.trim(),
        delivery_lga: delivery_lga?.trim() || null,
        delivery_landmark: delivery_landmark?.trim() || null,
        subtotal,
        total_amount: totalAmount,
        shipping_fee_paid: shippingFee,
        discount_amount: discountAmount,
        payment_status: 'pending',
        overall_status: 'pending',
        payment_reference: paymentReference,
        special_instructions: special_instructions?.trim() || null,
        order_notes: order_notes?.trim() || null,
        metadata: {
          voucher_code: voucherRow ? voucherRow.code : null,
          source: 'pwa',
        },
      })
      .select('id, order_number')
      .single();

    if (orderErr) return jsonResponse(500, { error: 'Failed to create order', detail: orderErr.message });
    const orderId = order.id;
    const orderNumber = order.order_number;

    // ── Insert order items ─────────────────────────────────────────────────
    const { error: itemsErr } = await adminClient.from('order_items').insert(
      resolvedItems.map((i) => ({
        order_id: orderId,
        product_id: i.product_id,
        product_name: i.product_name,
        product_sku: i.product_sku,
        variation_id: i.variation_id,
        variation_details: i.variation_details,
        vendor_id: i.vendor_id,
        hub_id: i.hub_id,
        unit_price: i.unit_price,
        quantity: i.quantity,
        subtotal: i.subtotal,
      }))
    );
    if (itemsErr) return jsonResponse(500, { error: 'Failed to save order items', detail: itemsErr.message });

    // ── Group into sub-orders by vendor ────────────────────────────────────
    const vendorGroups = new Map();
    for (const item of resolvedItems) {
      const key = item._vendorId || 'unassigned';
      if (!vendorGroups.has(key)) {
        vendorGroups.set(key, {
          vendor_id: item._vendorId,
          hub_id: item._hubId,
          items: [],
          subtotal: 0,
        });
      }
      const group = vendorGroups.get(key);
      group.subtotal += item.subtotal;
      group.items.push({
        productId: item.product_id,
        variationId: item.variation_id,
        name: item._name,
        sku: item._sku,
        price: item.unit_price,
        quantity: item.quantity,
        total: item.subtotal,
        vendorId: item._vendorId,
        hubId: item._hubId,
        variationAttributes: item._variationAttributes,
      });
    }

    // ── Resolve courier per hub ────────────────────────────────────────────
    // Prefer a Fez courier (code='fez') so the dispatch UI is available;
    // fall back to the highest-priority primary courier for the hub.
    const hubIds = [...new Set(
      Array.from(vendorGroups.values()).map((g) => g.hub_id).filter(Boolean)
    )];

    const hubCourierMap = {};
    if (hubIds.length > 0) {
      const { data: hcRows } = await adminClient
        .from('hub_couriers')
        .select('hub_id, courier_id, priority, couriers!inner(code)')
        .in('hub_id', hubIds)
        .eq('is_primary', true)
        .order('hub_id')
        .order('priority', { ascending: false });

      for (const row of (hcRows || [])) {
        const hubId = row.hub_id;
        const isFez = row.couriers?.code?.toLowerCase() === 'fez';
        if (!hubCourierMap[hubId]) {
          // First result for this hub (highest priority)
          hubCourierMap[hubId] = { courierId: row.courier_id, hasFez: isFez };
        } else if (isFez && !hubCourierMap[hubId].hasFez) {
          // Override with Fez if we haven't found one yet
          hubCourierMap[hubId] = { courierId: row.courier_id, hasFez: true };
        }
      }
    }

    const subOrderRows = Array.from(vendorGroups.values()).map((g) => ({
      main_order_id: orderId,
      vendor_id: g.vendor_id,
      hub_id: g.hub_id,
      courier_id: hubCourierMap[g.hub_id]?.courierId || null,
      items: g.items,
      subtotal: g.subtotal,
      allocated_shipping_fee: vendorGroups.size === 1 ? shippingFee : 0,
      status: 'pending',
    }));

    const { error: subErr } = await adminClient.from('sub_orders').insert(subOrderRows);
    if (subErr) return jsonResponse(500, { error: 'Failed to create sub-orders', detail: subErr.message });

    // ── Increment voucher usage ────────────────────────────────────────────
    if (voucherRow) {
      await adminClient
        .from('campaign_vouchers')
        .update({ current_uses: (voucherRow.current_uses || 0) + 1 })
        .eq('id', voucherRow.id);
    }

    // ── Send order confirmation emails (non-blocking) ─────────────────────
    sendOrderEmails(adminClient, {
      orderNumber,
      customer_name,
      customer_email,
      customer_phone,
      delivery_address,
      delivery_city,
      delivery_state,
      subtotal,
      discountAmount,
      shippingFee,
      totalAmount,
      resolvedItems,
    }).catch(() => {});

    return jsonResponse(201, {
      success: true,
      data: {
        order_id: orderId,
        order_number: orderNumber,
        payment_reference: paymentReference,
        subtotal,
        discount_amount: discountAmount,
        shipping_fee: shippingFee,
        total_amount: totalAmount,
        item_count: resolvedItems.length,
      },
    });

  } catch (err) {
    return jsonResponse(500, { error: 'Order creation failed', message: err?.message || String(err) });
  }
}
