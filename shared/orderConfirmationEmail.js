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
      .select('product_name, vendor_id, quantity, subtotal, variation_details')
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
          push(vid, {
            product_name: name,
            quantity: qty,
            subtotal: sub,
            vendor_id: vid,
            variation_details: { attributes: [] },
          });
        }
      } else {
        push(vid, {
          product_name: 'New order — open Vendor Portal for line items',
          quantity: 1,
          subtotal: Number(so.subtotal || 0),
          vendor_id: vid,
          variation_details: { attributes: [] },
        });
      }
    }
  } else {
    for (const row of oiRows || []) {
      if (!row.vendor_id) continue;
      push(row.vendor_id, {
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

  if (map.size === 0) {
    console.warn(
      '[sendOrderEmails] No vendor on sub_orders / order_items / resolvedItems — vendor emails skipped. ' +
        'Ensure sub_orders.vendor_id is set and vendors.email is populated.',
    );
  }

  return map;
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
      const { data: vendors, error: vendorsErr } = await supabase
        .from('vendors')
        .select('id, email, store_name, display_name, user_id')
        .in('id', vendorIds);
      if (vendorsErr) {
        console.error('[sendOrderEmails] vendors lookup:', vendorsErr.message);
      }
      const vendorById = new Map((vendors || []).map((v) => [String(v.id), v]));

      for (const vid of vendorIds) {
        const vendor = vendorById.get(String(vid));
        const vendorSubject = `New Order #${orderNumber} - Action Required`;
        if (!vendor) {
          await logOrderEmail(supabase, {
            orderId,
            recipient: '(no vendor row)',
            subject: vendorSubject,
            status: 'failed',
            errorMessage: `No vendors row for id ${vid}. sub_orders/order_items reference an id that does not exist.`,
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
