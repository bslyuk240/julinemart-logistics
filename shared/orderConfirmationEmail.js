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
        const vendorSubject = `New Order #${orderNumber} - Action Required`;
        try {
          await transporter.sendMail({ from, to: vendor.email, subject: vendorSubject, html: vendorHtml });
          await logOrderEmail(supabase, {
            orderId,
            recipient: vendor.email,
            subject: vendorSubject,
            status: 'sent',
          });
        } catch (err) {
          await logOrderEmail(supabase, {
            orderId,
            recipient: vendor.email,
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
