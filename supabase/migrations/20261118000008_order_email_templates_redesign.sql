-- Redesign the six customer order emails (editorial layout, brand purple, no
-- gradients/emoji). Only html_content and subject change; every {{variable}}
-- and text_content is untouched. Pre-change copy of the whole table:
-- backup.email_templates_20261118.
with
shell(s) as (
  select $shell$<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light">
<title>@@TITLE@@ - JulineMart</title>
</head>
<body style="margin:0;padding:0;background:#f6f3f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f3f7;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;background:#ffffff;border-top:4px solid #670779;">
<tr><td style="padding:32px 40px 0;">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="padding-right:12px;"><img src="https://res.cloudinary.com/dupgdbwrt/image/upload/v1759971092/icon-512x512.png_ygtda9.png" alt="" width="36" height="36" style="display:block;border:0;"></td>
<td style="font-family:Georgia,'Times New Roman',serif;font-size:20px;color:#2d0334;letter-spacing:-0.2px;">JulineMart</td>
</tr></table>
</td></tr>
<tr><td style="padding:40px 40px 8px;">
<h1 style="margin:0 0 20px;font-family:Georgia,'Times New Roman',serif;font-size:30px;line-height:1.2;font-weight:normal;color:#1f1424;letter-spacing:-0.5px;">@@HEADLINE@@</h1>
<p style="margin:0 0 12px;font-size:16px;line-height:1.6;font-weight:600;color:#1f1424;">Hi {{customerName}},</p>
<p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#3d3543;">@@LEAD@@</p>
@@BODY@@
@@CTA@@
</td></tr>
<tr><td style="padding:32px 40px 40px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e7e1e9;"><tr>
<td style="padding-top:24px;font-size:13px;line-height:1.6;color:#6b6472;">Need a hand? Write to <a href="mailto:info@julinemart.com" style="color:#670779;">info@julinemart.com</a> and quote your order number.</td>
</tr></table>
</td></tr>
</table>
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;"><tr>
<td style="padding:20px 40px;font-size:12px;line-height:1.7;color:#6b6472;">JulineMart, Nigeria's trusted marketplace<br>Lagos &middot; Warri &middot; Abuja</td>
</tr></table>
</td></tr></table>
</body>
</html>$shell$
),
fmt(rw, tbl_open, tbl_close, btn, steps) as (
  select
    '<tr><td style="padding:13px 0;border-bottom:1px solid #e7e1e9;font-size:14px;color:#6b6472;width:130px;">%s</td><td style="padding:13px 0;border-bottom:1px solid #e7e1e9;font-size:15px;font-weight:600;color:#1f1424;">%s</td></tr>',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e7e1e9;margin:0 0 28px;">',
    '</table>',
    '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 8px;"><tr><td style="background:#670779;border-radius:2px;"><a href="%s" style="display:inline-block;padding:15px 32px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;">%s</a></td></tr></table>',
    '<p style="margin:28px 0 8px;font-size:16px;font-weight:600;color:#1f1424;">What happens next</p><p style="margin:0;font-size:15px;line-height:1.7;color:#3d3543;">We prepare your items for shipment.<br>You get a shipping confirmation email.<br>Track your package until it arrives.</p>'
),
items(type, subject, title, headline, lead, body, cta) as (
  select 'order_confirmation', 'Order Confirmed - #{{orderNumber}}', 'Order confirmed',
    'Thank you. Your order is confirmed.',
    'We''ve received order <strong style="color:#670779;">#{{orderNumber}}</strong> and it''s being prepared for shipment. We''ll email you again as soon as it''s on its way.',
    f.tbl_open || format(f.rw, 'Order number', '#{{orderNumber}}') || format(f.rw, 'Placed on', '{{orderDate}}') || format(f.rw, 'Order total', 'NGN {{totalAmount}}') || f.tbl_close,
    format(f.btn, '{{trackingUrl}}', 'Track your order') || f.steps
  from fmt f
  union all
  select 'order_processing', 'Order Processing - #{{orderNumber}}', 'Order being prepared',
    'Your order is being packed',
    'Order <strong style="color:#670779;">#{{orderNumber}}</strong> is being packed and will ship soon.',
    '',
    format(f.btn, '{{trackingUrl}}', 'Track your order')
  from fmt f
  union all
  select 'order_shipped', 'Order Shipped! Track #{{orderNumber}}', 'Order shipped',
    'Your order is on its way',
    'Order <strong style="color:#670779;">#{{orderNumber}}</strong> has been shipped.',
    f.tbl_open || format(f.rw, 'Order number', '#{{orderNumber}}') || format(f.rw, 'Tracking number', '{{trackingNumber}}') || f.tbl_close,
    format(f.btn, '{{trackingUrl}}', 'Track your order')
  from fmt f
  union all
  select 'out_for_delivery', 'Out for Delivery Today - Order #{{orderNumber}}', 'Out for delivery',
    'Arriving today',
    'Order <strong style="color:#670779;">#{{orderNumber}}</strong> is out for delivery and will arrive today. Please make sure someone is available to receive it.',
    '',
    format(f.btn, '{{trackingUrl}}', 'Track your order')
  from fmt f
  union all
  select 'order_delivered', 'Delivered: Order #{{orderNumber}}', 'Delivered',
    'Your order has been delivered',
    'Order <strong style="color:#670779;">#{{orderNumber}}</strong> has been delivered. We hope you love your purchase, and thank you for shopping with JulineMart.',
    '',
    format(f.btn, 'https://julinemart.com', 'Shop again')
  from fmt f
  union all
  select 'order_cancelled', 'Order Cancelled - #{{orderNumber}}', 'Order cancelled',
    'Your order was cancelled',
    'Order <strong style="color:#670779;">#{{orderNumber}}</strong> has been cancelled. If you made a payment, your refund will be processed within 5-7 business days.',
    f.tbl_open || format(f.rw, 'Order number', '#{{orderNumber}}') || format(f.rw, 'Order amount', 'NGN {{totalAmount}}') || f.tbl_close,
    ''
  from fmt f
)
update public.email_templates t
set subject = i.subject,
    html_content = replace(replace(replace(replace(replace(sh.s,
      '@@TITLE@@', i.title), '@@HEADLINE@@', i.headline), '@@LEAD@@', i.lead), '@@BODY@@', i.body), '@@CTA@@', i.cta),
    updated_at = now()
from items i, shell sh
where t.type = i.type;
