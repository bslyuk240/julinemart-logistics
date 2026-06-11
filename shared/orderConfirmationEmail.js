/**
 * Order confirmation emails (customer, staff, vendor).
 * PWA orders: all notifications fire after Paystack payment via sendOrderEmailsForPaidOrder.
 */
import nodemailer from 'nodemailer';
import { decryptEmailConfigSecrets } from './emailSecretsCrypto.js';
import { buildCustomSmtpTransportOptions } from './smtpTransport.js';
import { buildVendorNewOrderInstructionHtml } from './vendorFulfillment.js';

export async function logOrderEmail(supabase, { orderId, recipient, subject, status, errorMessage }) {
  try {
    await supabase.from('email_logs').insert({
      order_id: orderId || null,
      recipient,
      subject,
      status,
      error_message: errorMessage || null,
      sent_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('email_logs insert failed:', e?.message || e);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Human-readable variation text for emails (Woo + Supabase shapes).
 * Attributes may be { name, option }, { name, value }, or legacy objects.
 */
function attrOptionValue(attr) {
  if (!attr || typeof attr !== 'object') return '';
  const name = attr.name || attr.attribute || attr.label || '';
  const val = attr.option ?? attr.value ?? attr.option_value;
  if (name && val !== undefined && val !== '') return `${name}: ${val}`;
  if (val !== undefined && val !== '') return String(val);
  return name ? String(name) : '';
}

function formatVariationSuffixFromDetails(variationDetails) {
  if (!variationDetails) return '';
  const attrs = variationDetails.attributes;
  if (!attrs) return '';
  if (Array.isArray(attrs)) {
    const parts = attrs.map(attrOptionValue).filter(Boolean);
    return parts.length ? ` (${parts.join(', ')})` : '';
  }
  if (typeof attrs === 'object') {
    const parts = Object.entries(attrs)
      .map(([k, v]) => (v != null && String(v) !== '' ? `${k}: ${v}` : ''))
      .filter(Boolean);
    return parts.length ? ` (${parts.join(', ')})` : '';
  }
  return '';
}

/** sub_orders.items line (from create-order) may carry variationAttributes array */
function formatVariationSuffixFromLineItem(it) {
  if (it.variation_details) return formatVariationSuffixFromDetails(it.variation_details);
  const raw = it.variationAttributes;
  if (Array.isArray(raw) && raw.length > 0) {
    return formatVariationSuffixFromDetails({ attributes: raw });
  }
  return '';
}

function lineItemDisplayName(row) {
  const base = row.product_name || 'Item';
  const fromDet = formatVariationSuffixFromDetails(row.variation_details);
  if (fromDet) return `${base}${fromDet}`;
  const arr = row._variationAttributes || row.variationAttributes;
  if (Array.isArray(arr) && arr.length > 0) {
    return `${base}${formatVariationSuffixFromDetails({ attributes: arr })}`;
  }
  return `${base}${formatVariationSuffixFromLineItem(row)}`;
}

function lineItemDisplayNameFromResolved(i) {
  return lineItemDisplayName(i);
}

/** Normalize sub_orders.items (JSONB may arrive as array, string, or wrapped object). */
function parseSubOrderItemsJson(raw) {
  let v = raw;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      return [];
    }
  }
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object') {
    const inner = v.items || v.lineItems || v.line_items;
    if (Array.isArray(inner)) return inner;
  }
  return [];
}

/**
 * Line items grouped by vendor for "new order" vendor emails.
 *
 * Uses **sub_orders** first (same as vendor portal), then fills gaps from **order_items** so a
 * webhook race or partial sub_order row still gets vendor mail. Falls back to **resolvedItems**.
 */
async function buildVendorItemMapOnce(supabase, orderId, resolvedItems) {
  const map = new Map();

  const push = (vendorId, row) => {
    if (vendorId == null || vendorId === '') return;
    const key = String(vendorId);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  };

  if (!orderId) {
    for (const item of resolvedItems || []) {
      if (!item.vendor_id) continue;
      push(item.vendor_id, item);
    }
    return map;
  }

  const [{ data: subs, error: soErr }, { data: oiRows, error: oiErr }] = await Promise.all([
    supabase.from('sub_orders').select('vendor_id, items, subtotal').eq('main_order_id', orderId),
    supabase
      .from('order_items')
      .select('product_id, product_name, vendor_id, quantity, subtotal, variation_details')
      .eq('order_id', orderId),
  ]);

  if (soErr) console.error('[sendOrderEmails] sub_orders:', soErr.message);
  if (oiErr) console.error('[sendOrderEmails] order_items:', oiErr.message);

  const hasSubVendor = (subs || []).some((so) => so.vendor_id != null && so.vendor_id !== '');

  if (hasSubVendor) {
    for (const so of subs || []) {
      const vid = so.vendor_id;
      if (vid == null || vid === '') continue;
      const rawItems = parseSubOrderItemsJson(so.items);
      if (rawItems.length > 0) {
        for (const it of rawItems) {
          const name = it.name || it.productName || 'Item';
          const qty = it.quantity ?? 1;
          const sub = Number(it.total ?? it.subtotal ?? 0);
          const productId = it.productId || it.product_id || null;
          const variationDetails =
            it.variation_details ||
            (Array.isArray(it.variationAttributes) && it.variationAttributes.length > 0
              ? { attributes: it.variationAttributes }
              : null);
          push(vid, {
            product_name: name,
            quantity: qty,
            subtotal: sub,
            vendor_id: vid,
            product_id: productId,
            variation_details: variationDetails || { attributes: [] },
            variationAttributes: it.variationAttributes,
          });
        }
      } else {
        push(vid, {
          product_name: 'New order — open Vendor Portal for line items',
          quantity: 1,
          subtotal: Number(so.subtotal || 0),
          vendor_id: vid,
          product_id: null,
          variation_details: { attributes: [] },
        });
      }
    }
  } else {
    for (const row of oiRows || []) {
      if (!row.vendor_id) continue;
      push(row.vendor_id, {
        product_id: row.product_id,
        product_name: row.product_name,
        quantity: row.quantity,
        subtotal: Number(row.subtotal),
        vendor_id: row.vendor_id,
        variation_details: row.variation_details || { attributes: [] },
      });
    }
  }

  // Augment: any vendor on order_items missing from map (sub_orders lag, or vendor only on lines)
  for (const row of oiRows || []) {
    if (!row.vendor_id) continue;
    const key = String(row.vendor_id);
    if (!map.has(key)) {
      push(row.vendor_id, {
        product_id: row.product_id,
        product_name: row.product_name,
        quantity: row.quantity,
        subtotal: Number(row.subtotal),
        vendor_id: row.vendor_id,
        variation_details: row.variation_details || { attributes: [] },
      });
    }
  }

  if (map.size === 0) {
    for (const item of resolvedItems || []) {
      if (!item.vendor_id) continue;
      push(item.vendor_id, item);
    }
  }

  return map;
}

/**
 * Orders often carry a stale sub_orders.vendor_id / order_items.vendor_id with no matching vendors row
 * (migration, duplicate vendor records). Products still point at the live vendors.id — remap lines using
 * product_id → products.vendor_id when the order's vendor id is orphaned.
 */
async function remapOrphanVendorIdsToProductVendors(supabase, orderId, map) {
  if (!orderId || map.size === 0) return map;

  const keys = [...map.keys()];
  const { data: vendorRows } = await supabase.from('vendors').select('id').in('id', keys);
  const validKeys = new Set((vendorRows || []).map((v) => String(v.id)));
  const orphanKeys = keys.filter((k) => !validKeys.has(String(k)));
  if (orphanKeys.length === 0) return map;

  const { data: oiAll } = await supabase
    .from('order_items')
    .select('product_id, product_name')
    .eq('order_id', orderId);

  const nameToPid = new Map();
  for (const r of oiAll || []) {
    if (r.product_id && r.product_name) {
      nameToPid.set(String(r.product_name).trim().toLowerCase(), r.product_id);
    }
  }

  const productIdSet = new Set();
  for (const r of oiAll || []) {
    if (r.product_id) productIdSet.add(String(r.product_id));
  }
  for (const ok of orphanKeys) {
    for (const line of map.get(ok) || []) {
      if (line.product_id) productIdSet.add(String(line.product_id));
    }
  }

  const productIds = [...productIdSet];
  const { data: products } = productIds.length
    ? await supabase.from('products').select('id, vendor_id').in('id', productIds)
    : { data: [] };

  const pidToVendor = new Map(
    (products || []).filter((p) => p.vendor_id).map((p) => [String(p.id), p.vendor_id]),
  );

  const candVids = [...new Set([...pidToVendor.values()].map(String))];
  const { data: vendorsExist } = candVids.length
    ? await supabase.from('vendors').select('id').in('id', candVids)
    : { data: [] };
  const vendorExists = new Set((vendorsExist || []).map((v) => String(v.id)));

  for (const orphanKey of orphanKeys) {
    const lines = map.get(orphanKey);
    if (!lines?.length) continue;
    map.delete(orphanKey);

    const buckets = new Map();
    const stillBad = [];

    for (const line of lines) {
      let pid = line.product_id || null;
      if (!pid && line.product_name) {
        pid = nameToPid.get(String(line.product_name).trim().toLowerCase()) || null;
      }
      const vidFromProduct = pid ? pidToVendor.get(String(pid)) : null;
      if (vidFromProduct && vendorExists.has(String(vidFromProduct))) {
        const k = String(vidFromProduct);
        if (!buckets.has(k)) buckets.set(k, []);
        buckets.get(k).push({
          ...line,
          vendor_id: vidFromProduct,
          product_id: pid || line.product_id,
        });
      } else {
        stillBad.push(line);
      }
    }

    for (const [vid, ls] of buckets) {
      if (!map.has(vid)) map.set(vid, []);
      map.get(vid).push(...ls);
    }
    if (stillBad.length) map.set(orphanKey, stillBad);
  }

  if (orphanKeys.some((k) => map.has(k))) {
    console.warn(
      '[sendOrderEmails] Some order lines still reference vendor ids with no vendors row after product remap. ' +
        'Fix products.vendor_id / sub_orders.vendor_id in the database.',
    );
  }

  return map;
}

async function buildVendorItemMap(supabase, orderId, resolvedItems) {
  let map = await buildVendorItemMapOnce(supabase, orderId, resolvedItems);
  if (map.size === 0 && orderId) {
    await sleep(350);
    map = await buildVendorItemMapOnce(supabase, orderId, resolvedItems);
  }
  if (map.size === 0 && orderId) {
    await sleep(500);
    map = await buildVendorItemMapOnce(supabase, orderId, resolvedItems);
  }

  if (orderId && map.size > 0) {
    await remapOrphanVendorIdsToProductVendors(supabase, orderId, map);
  }

  if (map.size === 0) {
    console.warn(
      '[sendOrderEmails] No vendor on sub_orders / order_items / resolvedItems — vendor emails skipped. ' +
        'Ensure sub_orders.vendor_id is set and vendors.email is populated.',
    );
  }

  return map;
}

/** Columns that exist on all vendor rows (avoid optional columns that break PostgREST in some DBs). */
const VENDOR_EMAIL_SELECT = 'id, email, store_name, user_id, hub_id, fez_collection_method, approved_vendor_locations(fez_hub_name, fez_hub_address, hubs(name, address, city))';

/**
 * Load vendor rows for notification. Batch `.in()` first; then per-id `.eq()` for any miss
 * (PostgREST batch edge cases, or partial failures).
 */
async function fetchVendorRowsForEmail(supabase, vendorIds) {
  const ids = [...new Set(vendorIds.map(String))];
  if (ids.length === 0) {
    return { vendorById: new Map(), batchErr: null, allMissingAfterFallback: false };
  }

  const { data: batch, error: batchErr } = await supabase
    .from('vendors')
    .select(VENDOR_EMAIL_SELECT)
    .in('id', ids);

  if (batchErr) {
    console.error('[sendOrderEmails] vendors batch lookup:', batchErr.message);
  }

  const vendorById = new Map((batch || []).map((v) => [String(v.id), v]));
  const missing = ids.filter((id) => !vendorById.has(id));

  for (const vid of missing) {
    const { data: one, error: oneErr } = await supabase
      .from('vendors')
      .select(VENDOR_EMAIL_SELECT)
      .eq('id', vid)
      .maybeSingle();
    if (oneErr) {
      console.error('[sendOrderEmails] vendors id lookup', vid, oneErr.message);
    } else if (one) {
      vendorById.set(String(vid), one);
    }
  }

  const allMissingAfterFallback = ids.length > 0 && vendorById.size === 0 && !batchErr;
  return { vendorById, batchErr, allMissingAfterFallback };
}

async function loadEmailTransport(supabase) {
  const { data: rawCfg, error: cfgErr } = await supabase
    .from('email_config')
    .select('*')
    .limit(1)
    .maybeSingle();
  if (cfgErr) {
    console.error('email_config load failed:', cfgErr.message);
  }
  const cfg = rawCfg ? decryptEmailConfigSecrets(rawCfg) : null;
  if (!cfg?.email_enabled) {
    return { cfg: null, transporter: null, from: null };
  }

  let transportConfig;
  let from;
  if (cfg.provider === 'gmail') {
    transportConfig = { service: 'gmail', auth: { user: cfg.gmail_user, pass: cfg.gmail_password } };
    from = cfg.email_from || cfg.gmail_user;
  } else if (cfg.provider === 'sendgrid') {
    transportConfig = { host: 'smtp.sendgrid.net', port: 587, auth: { user: 'apikey', pass: cfg.sendgrid_api_key } };
    from = cfg.email_from;
  } else {
    transportConfig = buildCustomSmtpTransportOptions(cfg);
    from = cfg.email_from || cfg.smtp_user;
  }
  if (!from) {
    return { cfg, transporter: null, from: null };
  }

  return { cfg, transporter: nodemailer.createTransport(transportConfig), from };
}

/**
 * Vendor "new order" emails — only after payment is confirmed (see sendVendorNewOrderEmailsForPaidOrder).
 */
export async function sendVendorNewOrderEmails(
  supabase,
  {
    orderId,
    orderNumber,
    delivery_city,
    delivery_state,
    resolvedItems,
    transporter,
    from,
  },
) {
  if (!transporter || !from) return { sent: 0 };

  const fmt = (n) => `₦${Number(n).toLocaleString()}`;
  const safeItems = Array.isArray(resolvedItems) ? resolvedItems : [];
  const vendorItemMap = await buildVendorItemMap(supabase, orderId, safeItems);

  if (vendorItemMap.size === 0) return { sent: 0 };

  const vendorPortalBase = (process.env.VENDOR_PORTAL_URL || 'https://vendors.julinemart.com').replace(/\/+$/, '');
  const vendorOrdersUrl = `${vendorPortalBase}/orders`;
  const vendorIds = [...vendorItemMap.keys()];
  const { vendorById, batchErr: vendorsErr, allMissingAfterFallback: vendorsBulkEmpty } =
    await fetchVendorRowsForEmail(supabase, vendorIds);

  if (vendorsBulkEmpty) {
    console.error(
      '[sendVendorNewOrderEmails] vendors lookup returned 0 rows after batch + per-id fallback for',
      vendorIds.length,
      'id(s).',
      { vendorIds },
    );
  }

  let sent = 0;
  for (const vid of vendorIds) {
    const vendor = vendorById.get(String(vid));
    const vendorSubject = `New Order #${orderNumber} - Action Required`;
    if (!vendor) {
      let detail = '';
      if (vendorsErr) {
        detail = `Vendors query failed: ${vendorsErr.message}`;
      } else if (vendorsBulkEmpty) {
        detail = `No vendors row returned for id ${vid}.`;
      } else {
        detail = `No vendors row for id ${vid}.`;
      }
      await logOrderEmail(supabase, {
        orderId,
        recipient: '(no vendor row)',
        subject: vendorSubject,
        status: 'failed',
        errorMessage: detail,
      });
      continue;
    }

    let toEmail = (vendor.email && String(vendor.email).trim()) || '';
    if (!toEmail && vendor.user_id) {
      try {
        const { data: authData, error: authErr } = await supabase.auth.admin.getUserById(vendor.user_id);
        if (!authErr && authData?.user?.email) {
          toEmail = String(authData.user.email).trim();
        }
      } catch (_e) {
        /* non-fatal */
      }
    }
    if (!toEmail) {
      await logOrderEmail(supabase, {
        orderId,
        recipient: '(no email)',
        subject: vendorSubject,
        status: 'failed',
        errorMessage: `Vendor ${vendor.id} has no vendors.email and auth user email could not be loaded.`,
      });
      continue;
    }

    const vItems = vendorItemMap.get(String(vid)) || [];
    const vRows = vItems
      .map((i) => {
        const label = lineItemDisplayName(i);
        return `<tr><td style="padding:6px 12px;border-bottom:1px solid #f3f3f3">${label}</td><td style="padding:6px 12px;border-bottom:1px solid #f3f3f3;text-align:center">${i.quantity}</td><td style="padding:6px 12px;border-bottom:1px solid #f3f3f3;text-align:right">${fmt(i.subtotal)}</td></tr>`;
      })
      .join('');
    const vendorHtml = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
  <div style="background:#6b21a8;color:#fff;padding:30px;text-align:center">
    <h1 style="margin:0;font-size:22px">New Order Received 📦</h1>
    <p style="margin:8px 0 0;opacity:.85">Order #${orderNumber}</p>
  </div>
  <div style="padding:30px;background:#fff">
    <p>Hi ${vendor.store_name || 'Vendor'},</p>
    <p>Payment has been confirmed. Please prepare the following items:</p>
    <table style="width:100%;border-collapse:collapse;margin:20px 0">
      <thead><tr style="background:#f9f9f9"><th style="padding:8px 12px;text-align:left">Item</th><th style="padding:8px 12px;text-align:center">Qty</th><th style="padding:8px 12px;text-align:right">Total</th></tr></thead>
      <tbody>${vRows}</tbody>
    </table>
    <div style="padding:16px;background:#fef9c3;border-radius:8px;margin-top:16px">
      <p style="margin:0;font-weight:bold">Customer delivery area: ${delivery_city}, ${delivery_state}</p>
      ${buildVendorNewOrderInstructionHtml(vendor, { deliveryCity: delivery_city, deliveryState: delivery_state })}
    </div>
    <p style="margin-top:20px">Open <a href="${vendorOrdersUrl}" style="color:#6b21a8;font-weight:600">your vendor portal (Orders)</a> to view this order and fulfil it.</p>
  </div>
</div>`;
    try {
      await transporter.sendMail({ from, to: toEmail, subject: vendorSubject, html: vendorHtml });
      await logOrderEmail(supabase, {
        orderId,
        recipient: toEmail,
        subject: vendorSubject,
        status: 'sent',
      });
      sent += 1;
    } catch (err) {
      await logOrderEmail(supabase, {
        orderId,
        recipient: toEmail,
        subject: vendorSubject,
        status: 'failed',
        errorMessage: err?.message || String(err),
      });
    }
  }

  return { sent, vendorIds };
}

/**
 * Send vendor new-order emails after Paystack confirms payment. Idempotent via email_logs.
 */
export async function sendVendorNewOrderEmailsForPaidOrder(supabase, orderId) {
  const { data: dup } = await supabase
    .from('email_logs')
    .select('id')
    .eq('order_id', orderId)
    .eq('status', 'sent')
    .ilike('subject', 'New Order #%')
    .limit(1)
    .maybeSingle();

  if (dup) {
    return { skipped: true, reason: 'vendor_emails_already_sent' };
  }

  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .select(
      'id, order_number, payment_status, delivery_city, delivery_state',
    )
    .eq('id', orderId)
    .maybeSingle();

  if (orderErr || !order) {
    console.error('[sendVendorNewOrderEmailsForPaidOrder] order load:', orderErr?.message || 'not found');
    return { skipped: true, reason: 'order_not_found' };
  }
  if (order.payment_status !== 'paid') {
    return { skipped: true, reason: 'payment_not_confirmed' };
  }

  const { data: itemRows } = await supabase
    .from('order_items')
    .select('product_id, product_name, variation_details, vendor_id, quantity, subtotal')
    .eq('order_id', orderId);

  const resolvedItems = (itemRows || []).map((row) => ({
    product_id: row.product_id,
    product_name: row.product_name,
    vendor_id: row.vendor_id,
    variation_details: row.variation_details || { attributes: [] },
    quantity: row.quantity,
    subtotal: Number(row.subtotal),
  }));

  const { transporter, from } = await loadEmailTransport(supabase);
  if (!transporter || !from) {
    console.warn('[sendVendorNewOrderEmailsForPaidOrder] email transport not configured');
    return { skipped: true, reason: 'email_disabled' };
  }

  return sendVendorNewOrderEmails(supabase, {
    orderId: order.id,
    orderNumber: order.order_number,
    delivery_city: order.delivery_city,
    delivery_state: order.delivery_state,
    resolvedItems,
    transporter,
    from,
  });
}

/**
 * Customer + staff + vendor emails after payment is confirmed. Idempotent via email_logs.
 */
export async function sendOrderEmailsForPaidOrder(supabase, orderId) {
  const { data: dup } = await supabase
    .from('email_logs')
    .select('id')
    .eq('order_id', orderId)
    .eq('status', 'sent')
    .ilike('subject', '%Confirmed - JulineMart%')
    .limit(1)
    .maybeSingle();

  if (dup) {
    return { skipped: true, reason: 'confirmation_already_sent' };
  }

  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .select(
      'id, order_number, payment_status, customer_name, customer_email, customer_phone, delivery_address, delivery_city, delivery_state, subtotal, discount_amount, shipping_fee_paid, total_amount',
    )
    .eq('id', orderId)
    .maybeSingle();

  if (orderErr || !order) {
    console.error('[sendOrderEmailsForPaidOrder] order load:', orderErr?.message || 'not found');
    return { skipped: true, reason: 'order_not_found' };
  }
  if (order.payment_status !== 'paid') {
    return { skipped: true, reason: 'payment_not_confirmed' };
  }

  const { data: itemRows } = await supabase
    .from('order_items')
    .select('product_id, product_name, variation_details, vendor_id, quantity, subtotal')
    .eq('order_id', orderId);

  const resolvedItems = (itemRows || []).map((row) => ({
    product_id: row.product_id,
    product_name: row.product_name,
    vendor_id: row.vendor_id,
    variation_details: row.variation_details || { attributes: [] },
    quantity: row.quantity,
    subtotal: Number(row.subtotal),
  }));

  await sendOrderEmails(
    supabase,
    {
      orderId: order.id,
      orderNumber: order.order_number,
      customer_name: order.customer_name,
      customer_email: order.customer_email,
      customer_phone: order.customer_phone || '',
      delivery_address: order.delivery_address,
      delivery_city: order.delivery_city,
      delivery_state: order.delivery_state,
      subtotal: Number(order.subtotal),
      discountAmount: Number(order.discount_amount || 0),
      shippingFee: Number(order.shipping_fee_paid || 0),
      totalAmount: Number(order.total_amount),
      resolvedItems,
    },
    {
      includeCustomerEmails: true,
      includeStaffEmails: true,
      includeVendorEmails: true,
    },
  );

  return { sent: true };
}

export async function sendOrderEmails(
  supabase,
  {
    orderId,
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
  },
  options = {},
) {
  const {
    includeCustomerEmails = false,
    includeStaffEmails = false,
    includeVendorEmails = false,
  } = options;
  try {
    const { cfg, transporter, from } = await loadEmailTransport(supabase);
    const customerSubject = `Order #${orderNumber} Confirmed - JulineMart`;

    if (!includeCustomerEmails && !includeStaffEmails && !includeVendorEmails) {
      return;
    }

    if (!cfg?.email_enabled) {
      if (includeCustomerEmails && customer_email) {
        await logOrderEmail(supabase, {
          orderId,
          recipient: customer_email,
          subject: customerSubject,
          status: 'failed',
          errorMessage:
            'Email notifications are turned off in Email Settings (email_enabled is false).',
        });
      }
      return;
    }

    if (!transporter || !from) {
      if (includeCustomerEmails && customer_email) {
        await logOrderEmail(supabase, {
          orderId,
          recipient: customer_email,
          subject: customerSubject,
          status: 'failed',
          errorMessage: 'From address is not configured (set Email From / provider user in Email Settings).',
        });
      }
      return;
    }
    const fmt = (n) => `₦${Number(n).toLocaleString()}`;

    const safeItems = Array.isArray(resolvedItems) ? resolvedItems : [];

    const itemRows = safeItems.map((i) => {
      const label = lineItemDisplayNameFromResolved(i);
      return `<tr><td style="padding:6px 12px;border-bottom:1px solid #f3f3f3">${label}</td><td style="padding:6px 12px;border-bottom:1px solid #f3f3f3;text-align:center">${i.quantity}</td><td style="padding:6px 12px;border-bottom:1px solid #f3f3f3;text-align:right">${fmt(i.subtotal)}</td></tr>`;
    }).join('');

    const customerHtml = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
  <div style="background:#6b21a8;color:#fff;padding:30px;text-align:center">
    <h1 style="margin:0;font-size:24px">Order Confirmed! 🎉</h1>
    <p style="margin:8px 0 0;opacity:.85">Order #${orderNumber}</p>
  </div>
  <div style="padding:30px;background:#fff">
    <p>Hi ${customer_name},</p>
    <p>Thank you for shopping with JulineMart! Your payment has been confirmed and your order is being processed.</p>
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

    if (includeCustomerEmails && customer_email) {
      try {
        await transporter.sendMail({ from, to: customer_email, subject: customerSubject, html: customerHtml });
        await logOrderEmail(supabase, {
          orderId,
          recipient: customer_email,
          subject: customerSubject,
          status: 'sent',
        });
      } catch (err) {
        await logOrderEmail(supabase, {
          orderId,
          recipient: customer_email,
          subject: customerSubject,
          status: 'failed',
          errorMessage: err?.message || String(err),
        });
      }
    }

    // ── Staff alert emails ────────────────────────────────────────────────────
    const alertRecipients = Array.isArray(cfg.order_alert_emails) ? cfg.order_alert_emails : [];
    if (includeStaffEmails && alertRecipients.length > 0) {
      const staffSubject = `🛍️ New Paid Order #${orderNumber} — ${customer_name} (${fmt(totalAmount)})`;
      const staffItemRows = safeItems.map((i) => {
        const label = lineItemDisplayNameFromResolved(i);
        return `<tr><td style="padding:5px 10px;border-bottom:1px solid #f3f3f3;font-size:13px">${label}</td><td style="padding:5px 10px;border-bottom:1px solid #f3f3f3;text-align:center;font-size:13px">${i.quantity}</td><td style="padding:5px 10px;border-bottom:1px solid #f3f3f3;text-align:right;font-size:13px">${fmt(i.subtotal)}</td></tr>`;
      }).join('');
      const adminBase = (process.env.ADMIN_URL || 'https://jlo.julinemart.com').replace(/\/+$/, '');
      const staffHtml = `
<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto">
  <div style="background:#6b21a8;color:#fff;padding:20px 24px">
    <h2 style="margin:0;font-size:18px">New Paid Order Received 🛍️</h2>
    <p style="margin:4px 0 0;opacity:.8;font-size:13px">Order #${orderNumber}</p>
  </div>
  <div style="padding:20px 24px;background:#fff">
    <table style="width:100%;border-collapse:collapse;margin-bottom:12px">
      <tr><td style="padding:3px 0;font-size:13px;color:#555;width:120px">Customer</td><td style="padding:3px 0;font-size:13px;font-weight:600">${customer_name}</td></tr>
      <tr><td style="padding:3px 0;font-size:13px;color:#555">Phone</td><td style="padding:3px 0;font-size:13px">${customer_phone || '—'}</td></tr>
      <tr><td style="padding:3px 0;font-size:13px;color:#555">City</td><td style="padding:3px 0;font-size:13px">${delivery_city}, ${delivery_state}</td></tr>
      <tr><td style="padding:3px 0;font-size:13px;color:#555">Total</td><td style="padding:3px 0;font-size:14px;font-weight:700;color:#6b21a8">${fmt(totalAmount)}</td></tr>
    </table>
    <table style="width:100%;border-collapse:collapse;margin:12px 0">
      <thead><tr style="background:#f5f5f5"><th style="padding:6px 10px;text-align:left;font-size:12px">Item</th><th style="padding:6px 10px;text-align:center;font-size:12px">Qty</th><th style="padding:6px 10px;text-align:right;font-size:12px">Total</th></tr></thead>
      <tbody>${staffItemRows}</tbody>
    </table>
    <a href="${adminBase}/admin/orders" style="display:inline-block;margin-top:12px;background:#6b21a8;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:13px;font-weight:600">View in JLO Admin →</a>
  </div>
  <div style="background:#f9f9f9;padding:10px 24px;font-size:11px;color:#999;text-align:center">JulineMart Logistics Orchestrator — Staff Alert</div>
</div>`;

      for (const alertEmail of alertRecipients) {
        const recipient = String(alertEmail || '').trim().toLowerCase();
        if (!recipient) continue;
        try {
          await transporter.sendMail({ from, to: recipient, subject: staffSubject, html: staffHtml });
          await logOrderEmail(supabase, { orderId, recipient, subject: staffSubject, status: 'sent' });
        } catch (err) {
          await logOrderEmail(supabase, { orderId, recipient, subject: staffSubject, status: 'failed', errorMessage: err?.message || String(err) });
        }
      }
    }

    if (includeVendorEmails) {
      await sendVendorNewOrderEmails(supabase, {
        orderId,
        orderNumber,
        delivery_city,
        delivery_state,
        resolvedItems: safeItems,
        transporter,
        from,
      });
    }
  } catch (err) {
    console.error('sendOrderEmails failed:', err?.message || err);
  }
}
