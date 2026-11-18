-- Redesign the seven customer returns/refund emails and the two staff/vendor
-- return alerts (same layout as 20261118000008). Only html_content changes;
-- subjects, text_content and every {{variable}} are untouched. Pre-change copy
-- of the whole table: backup.email_templates_20261118.
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
@@GREETING@@
<p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#3d3543;">@@LEAD@@</p>
@@BODY@@
@@CLOSING@@
</td></tr>
<tr><td style="padding:32px 40px 40px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e7e1e9;"><tr>
<td style="padding-top:24px;font-size:13px;line-height:1.6;color:#6b6472;">@@HELP@@</td>
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
fmt(rw, tbl_open, tbl_close, greet, help_cust, help_vendor, help_staff, note) as (
  select
    '<tr><td style="padding:13px 0;border-bottom:1px solid #e7e1e9;font-size:14px;color:#6b6472;width:130px;vertical-align:top;">%s</td><td style="padding:13px 0;border-bottom:1px solid #e7e1e9;font-size:15px;font-weight:600;color:#1f1424;">%s</td></tr>',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e7e1e9;margin:0 0 28px;">',
    '</table>',
    '<p style="margin:0 0 12px;font-size:16px;line-height:1.6;font-weight:600;color:#1f1424;">Hi {{customerName}},</p>',
    'Need a hand? Write to <a href="mailto:info@julinemart.com" style="color:#670779;">info@julinemart.com</a> and quote your order number.',
    'Questions? Write to the vendor support team at <a href="mailto:info@julinemart.com" style="color:#670779;">info@julinemart.com</a>.',
    'Internal notice for the JulineMart team. Please do not forward.',
    '<p style="margin:0;font-size:15px;line-height:1.6;color:#3d3543;">%s</p>'
),
items(type, title, headline, greeting, lead, body, closing, help) as (
  select 'return_request_received', 'Return request received',
    'We''ve received your return request', f.greet,
    'We received your return request for order <strong style="color:#670779;">#{{orderNumber}}</strong>. Please drop off your item at the designated hub.',
    f.tbl_open || format(f.rw, 'Return code', '{{returnCode}}') || format(f.rw, 'Return ID', '{{returnId}}') || f.tbl_close,
    '', f.help_cust
  from fmt f
  union all
  select 'return_approved', 'Return approved',
    'Your return is approved', f.greet,
    'Your return for order <strong style="color:#670779;">#{{orderNumber}}</strong> is approved. Drop off your item at any Fez hub.',
    f.tbl_open || format(f.rw, 'Tracking', '{{trackingNumbers}}') || f.tbl_close,
    '', f.help_cust
  from fmt f
  union all
  select 'return_in_transit', 'Return in transit',
    'Your return is on its way', f.greet,
    'Your return for order <strong style="color:#670779;">#{{orderNumber}}</strong> is on its way to us.',
    f.tbl_open || format(f.rw, 'Tracking number', '{{trackingNumber}}') || f.tbl_close,
    '', f.help_cust
  from fmt f
  union all
  select 'return_delivered_to_hub', 'Return received',
    'We''ve received your return', f.greet,
    'We received your return for order <strong style="color:#670779;">#{{orderNumber}}</strong>. Inspection is now in progress, and we''ll update you as soon as it''s done.',
    '', '', f.help_cust
  from fmt f
  union all
  select 'return_rejected', 'Return update',
    'An update on your return request', f.greet,
    'Your return request for order <strong style="color:#670779;">#{{orderNumber}}</strong> (Return ID: {{returnId}}) was not approved.',
    f.tbl_open || format(f.rw, 'Notes', '{{inspectionNotes}}') || f.tbl_close,
    format(f.note, 'If you have questions about this decision, please contact support and we''ll gladly go through it with you.'),
    f.help_cust
  from fmt f
  union all
  select 'refund_completed', 'Refund processed',
    'Your refund has been processed', f.greet,
    'Your refund for order <strong style="color:#670779;">#{{orderNumber}}</strong> has been processed. Please allow 3-7 business days for it to reflect in your account.',
    f.tbl_open || format(f.rw, 'Refund amount', 'NGN {{refundAmount}}') || format(f.rw, 'Return ID', '{{returnId}}') || f.tbl_close,
    '', f.help_cust
  from fmt f
  union all
  select 'refund_failed', 'Refund issue',
    'There was an issue with your refund', f.greet,
    'We ran into a problem processing your refund for order <strong style="color:#670779;">#{{orderNumber}}</strong>. We will contact you within 1-2 business days to put it right.',
    '', '', f.help_cust
  from fmt f
  union all
  select 'return_admin_alert', 'New return request',
    'New return request', '',
    'New return from {{customerName}} for order <strong style="color:#670779;">#{{orderNumber}}</strong>.',
    f.tbl_open || format(f.rw, 'Reason', '{{reasonCode}}') || f.tbl_close,
    '', f.help_staff
  from fmt f
  union all
  select 'return_vendor_alert', 'Return request',
    'A return was requested for your product', '',
    'A return request was raised for order <strong style="color:#670779;">#{{orderNumber}}</strong>.',
    f.tbl_open || format(f.rw, 'Items', '{{itemNames}}') || format(f.rw, 'Reason', '{{reasonCode}}') || f.tbl_close,
    '', f.help_vendor
  from fmt f
)
update public.email_templates t
set html_content = replace(replace(replace(replace(replace(replace(replace(sh.s,
      '@@TITLE@@', i.title), '@@HEADLINE@@', i.headline), '@@GREETING@@', i.greeting), '@@LEAD@@', i.lead),
      '@@BODY@@', i.body), '@@CLOSING@@', i.closing), '@@HELP@@', i.help),
    updated_at = now()
from items i, shell sh
where t.type = i.type;
