/**
 * Order confirmation + vendor alert emails (used by create-order and notify-order-confirmation).
 */
import nodemailer from 'nodemailer';
import { decryptEmailConfigSecrets } from './emailSecretsCrypto.js';
import { buildCustomSmtpTransportOptions } from './smtpTransport.js';

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
          push(vid, {
            product_name: name,
            quantity: qty,
            subtotal: sub,
            vendor_id: vid,
            product_id: productId,
            variation_details: { attributes: [] },
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
const VENDOR_EMAIL_SELECT = 'id, email, store_name, user_id';

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
) {
  try {
    const { data: rawCfg, error: cfgErr } = await supabase
      .from('email_config')
      .select('*')
      .limit(1)
      .maybeSingle();
    if (cfgErr) {
      console.error('email_config load failed:', cfgErr.message);
    }
    const cfg = rawCfg ? decryptEmailConfigSecrets(rawCfg) : null;

    const customerSubject = `Order #${orderNumber} Confirmed - JulineMart`;

    if (!cfg?.email_enabled) {
      await logOrderEmail(supabase, {
        orderId,
        recipient: customer_email,
        subject: customerSubject,
        status: 'failed',
        errorMessage:
          'Email notifications are turned off in Email Settings (email_enabled is false).',
      });
      return;
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
      await logOrderEmail(supabase, {
        orderId,
        recipient: customer_email,
        subject: customerSubject,
        status: 'failed',
        errorMessage: 'From address is not configured (set Email From / provider user in Email Settings).',
      });
      return;
    }

    const transporter = nodemailer.createTransport(transportConfig);
    const fmt = (n) => `₦${Number(n).toLocaleString()}`;

    const safeItems = Array.isArray(resolvedItems) ? resolvedItems : [];

    const itemRows = safeItems.map((i) =>
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

    const vendorItemMap = await buildVendorItemMap(supabase, orderId, safeItems);

    if (vendorItemMap.size > 0) {
      const vendorIds = [...vendorItemMap.keys()];
      const { vendorById, batchErr: vendorsErr, allMissingAfterFallback: vendorsBulkEmpty } =
        await fetchVendorRowsForEmail(supabase, vendorIds);

      if (vendorsBulkEmpty) {
        console.error(
          '[sendOrderEmails] vendors lookup returned 0 rows after batch + per-id fallback for',
          vendorIds.length,
          'id(s). Confirm Netlify SUPABASE_URL matches the same project as this key; service_role bypasses RLS. Wrong anon key or wrong project URL also yields empty reads.',
          { vendorIds },
        );
      }

      for (const vid of vendorIds) {
        const vendor = vendorById.get(String(vid));
        const vendorSubject = `New Order #${orderNumber} - Action Required`;
        if (!vendor) {
          let detail = '';
          if (vendorsErr) {
            detail = `Vendors query failed: ${vendorsErr.message}`;
          } else if (vendorsBulkEmpty) {
            detail =
              `No vendors row returned for id ${vid} after batch and per-id SELECT. If the row exists in Studio, verify Netlify SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are from the same Supabase project.`;
          } else {
            detail = `No vendors row for id ${vid} (orphan reference or partial lookup miss).`;
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
    <p>Hi ${vendor.store_name || 'Vendor'},</p>
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
        try {
          await transporter.sendMail({ from, to: toEmail, subject: vendorSubject, html: vendorHtml });
          await logOrderEmail(supabase, {
            orderId,
            recipient: toEmail,
            subject: vendorSubject,
            status: 'sent',
          });
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
    }
  } catch (err) {
    console.error('sendOrderEmails failed:', err?.message || err);
  }
}
