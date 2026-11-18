-- Redesign the 15 vendor/applicant emails (same layout as 20261118000008/9).
-- Only html_content changes; subjects, text_content and every {{variable}} and
-- link target are untouched. Pre-change copy: backup.email_templates_20261118.
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
fmt(rw, tbl_open, tbl_close, g_v, g_a, btn, btn2, st_h, st_o, st_c, li, para, ordn, loc,
    h_mail, h_portal, h_contact, h_staff, h_info) as (
  select
    '<tr><td style="padding:13px 0;border-bottom:1px solid #e7e1e9;font-size:14px;color:#6b6472;width:130px;vertical-align:top;">%s</td><td style="padding:13px 0;border-bottom:1px solid #e7e1e9;font-size:15px;font-weight:600;color:#1f1424;">%s</td></tr>',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e7e1e9;margin:0 0 28px;">',
    '</table>',
    '<p style="margin:0 0 12px;font-size:16px;line-height:1.6;font-weight:600;color:#1f1424;">Hi {{vendor_name}},</p>',
    '<p style="margin:0 0 12px;font-size:16px;line-height:1.6;font-weight:600;color:#1f1424;">Hi {{applicant_name}},</p>',
    '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 12px;"><tr><td style="background:#670779;border-radius:2px;"><a href="%s" style="display:inline-block;padding:15px 32px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;">%s</a></td></tr></table>',
    '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 12px;"><tr><td style="border:1px solid #670779;border-radius:2px;"><a href="%s" style="display:inline-block;padding:14px 31px;font-size:16px;font-weight:600;color:#670779;text-decoration:none;">%s</a></td></tr></table>',
    '<p style="margin:8px 0 8px;font-size:16px;font-weight:600;color:#1f1424;">%s</p>',
    '<ol style="margin:0 0 28px;padding-left:22px;font-size:15px;line-height:1.7;color:#3d3543;">',
    '</ol>',
    '<li style="margin:0 0 4px;padding-left:4px;">%s</li>',
    '<p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#3d3543;">%s</p>',
    '<strong style="color:#670779;">#{{order_number}}</strong>',
    '{{hub_name}}<br><span style="font-weight:400;color:#3d3543;">{{hub_address}}</span>',
    'Questions? Write to the vendor support team at <a href="mailto:%1$s" style="color:#670779;">%1$s</a>.',
    'View this order in your <a href="%s" style="color:#670779;">vendor portal</a>. Questions? Write to <a href="mailto:info@julinemart.com" style="color:#670779;">info@julinemart.com</a>.',
    'Need a hand? <a href="https://julinemart.com/contact" style="color:#670779;">Contact our support team</a>.',
    'Internal notice for the JulineMart team. Please do not forward.',
    'Questions? Write to the vendor support team at <a href="mailto:info@julinemart.com" style="color:#670779;">info@julinemart.com</a>.'
),
items(type, title, headline, greeting, lead, body, closing, help) as (
  -- Applicant
  select 'vendor_application_received', 'Application received', 'We''ve received your application', f.g_a,
    'We have received your application to sell on JulineMart as {{store_name}}. Our team will review your details and get back to you within <strong>2-3 business days</strong>.',
    format(f.st_h, 'What happens next') || f.st_o || format(f.li, 'Our team verifies your information and documents.') || format(f.li, 'You will receive an approval or follow-up email.') || f.st_c,
    '', f.h_contact
  from fmt f
  union all
  select 'vendor_application_rejected', 'Application update', 'An update on your vendor application', f.g_a,
    'Thank you for applying to become a JulineMart vendor with your store {{store_name}}. After reviewing your application, we are unable to proceed with your registration at this time.',
    f.tbl_open || format(f.rw, 'Reason', '{{reject_reason}}') || f.tbl_close,
    format(f.para, 'If you believe this decision was made in error, or your situation has changed, you are welcome to reapply or contact our support team.'),
    f.h_contact
  from fmt f
  union all
  select 'vendor_waitlist_confirmation', 'Waitlist confirmation', 'You''re on the waitlist', f.g_v,
    'Thank you for your interest in becoming a JulineMart vendor. We are not yet onboarding vendors from {{city}}, {{lga}}, {{state}}, but you are now on our waitlist.',
    format(f.para, 'We will send you an email as soon as your area becomes active. When that happens, you will be able to register and start selling immediately.'),
    '', format(f.h_mail, '{{support_email}}')
  from fmt f
  union all
  select 'vendor_waitlist_activation', 'Your city is live', 'JulineMart is now live in {{city}}, {{state}}', f.g_v,
    'Great news: JulineMart is now accepting vendor registrations from {{city}}, {{lga}}, {{state}}. You joined our waitlist and we promised to let you know. Now is your chance.',
    format(f.btn, '{{registration_url}}', 'Register now'),
    '', format(f.h_mail, '{{support_email}}')
  from fmt f
  -- Approved vendor
  union all
  select 'vendor_welcome', 'Welcome', 'Welcome to JulineMart', f.g_v,
    '{{store_name}} is approved on JulineMart. Check your inbox for the password setup email, then get started below.',
    format(f.st_h, 'Your first week') || f.st_o || format(f.li, 'Set your password from the invite email.') || format(f.li, 'Confirm your store, bank and pickup details.') || format(f.li, 'List your first products with clear photos and prices.') || f.st_c
      || format(f.btn, '{{portal_url}}', 'Open vendor portal'),
    '', format(f.h_mail, '{{support_email}}')
  from fmt f
  union all
  select 'vendor_account_update', 'Update your profile', 'Please update your vendor profile', f.g_v,
    'Please review the profile for {{store_name}}: your store details, bank account and pickup method.',
    format(f.btn, '{{portal_settings_url}}', 'Update profile'),
    '', format(f.h_mail, '{{support_email}}')
  from fmt f
  union all
  select 'vendor_activation_reminder', 'Kickstart your sales', 'Kickstart your sales', f.g_v,
    'Your store {{store_name}} is approved on JulineMart, but you haven''t listed any products yet.',
    format(f.btn, '{{portal_products_url}}', 'List your first item'),
    '', format(f.h_mail, '{{support_email}}')
  from fmt f
  union all
  select 'vendor_promotional_campaign', 'Campaign invitation', 'You''re invited: {{campaign_name}}', f.g_v,
    'We are inviting {{store_name}} to join {{campaign_name}}.',
    f.tbl_open || format(f.rw, 'Campaign dates', '{{campaign_dates}}') || f.tbl_close
      || format(f.para, '{{campaign_details}}') || format(f.btn, '{{join_url}}', 'Join campaign'),
    '', f.h_info
  from fmt f
  union all
  select 'vendor_monthly_sales_report', 'Monthly sales overview', 'Your monthly sales overview', f.g_v,
    'Here''s how {{store_name}} performed in {{month_label}}.',
    f.tbl_open || format(f.rw, 'Paid orders', '{{order_count}}') || format(f.rw, 'Gross sales', 'NGN {{gross_sales}}') || format(f.rw, 'Net earnings', 'NGN {{net_earnings}}') || f.tbl_close
      || format(f.btn, '{{portal_earnings_url}}', 'View earnings'),
    '', f.h_info
  from fmt f
  -- Orders and shipments
  union all
  select 'vendor_order_fez_pickup', 'New order', 'You have a new order', f.g_v,
    'You have a new order ' || f.ordn || '. Your collection method is set to Fez pickup, so a Fez rider will come to your shop to collect this parcel.',
    f.tbl_open || format(f.rw, 'Order total', '{{order_total}}') || format(f.rw, 'Items', '{{item_count}} item(s)') || f.tbl_close
      || format(f.st_h, 'What to do') || f.st_o
      || format(f.li, 'Pack the items securely.') || format(f.li, 'Go to your vendor portal, then Orders.') || format(f.li, 'Click Send to Fez to create the shipment.')
      || format(f.li, 'Print the label and stick it on the package.') || format(f.li, 'Have the parcel ready at your address for Fez collection.') || f.st_c,
    '', f.h_info
  from fmt f
  union all
  select 'vendor_order_hub_dropoff', 'New order', 'You have a new order', f.g_v,
    'You have a new order ' || f.ordn || '. Your collection method is set to hub drop-off, so please bring this parcel to your designated hub.',
    f.tbl_open || format(f.rw, 'Drop-off location', f.loc) || format(f.rw, 'Order total', '{{order_total}}') || format(f.rw, 'Items', '{{item_count}} item(s)') || f.tbl_close
      || format(f.st_h, 'What to do') || f.st_o
      || format(f.li, 'Pack the items securely.') || format(f.li, 'Go to your vendor portal, then Orders.') || format(f.li, 'Click Send to Fez to create the shipment.')
      || format(f.li, 'Print the label and stick it on the package.') || format(f.li, 'Drop the package at the hub address above.') || f.st_c,
    '', f.h_info
  from fmt f
  union all
  select 'vendor_shipment_ready_fez_hub', 'Shipment created', 'Your shipment label is ready', f.g_v,
    'JulineMart has created the Fez shipment for order ' || f.ordn || '. Print your label and drop the parcel off at the hub.',
    f.tbl_open || format(f.rw, 'Tracking number', '{{tracking_number}}') || format(f.rw, 'Drop-off location', f.loc) || f.tbl_close
      || format(f.btn, '{{label_url}}', 'Print shipping label') || format(f.btn2, '{{waybill_url}}', 'Print waybill')
      || format(f.st_h, 'What to do') || f.st_o
      || format(f.li, 'Print the label and stick it on the package.') || format(f.li, 'Print the waybill for your records.') || format(f.li, 'Drop the parcel at the Fez hub above.') || f.st_c,
    '', format(f.h_portal, '{{portal_orders_url}}')
  from fmt f
  union all
  select 'vendor_shipment_ready_fez_pickup', 'Shipment created', 'Your shipment label is ready', f.g_v,
    'JulineMart has created the Fez shipment for order ' || f.ordn || '. Print your label and get the parcel ready for pickup.',
    f.tbl_open || format(f.rw, 'Tracking number', '{{tracking_number}}') || f.tbl_close
      || format(f.btn, '{{label_url}}', 'Print shipping label') || format(f.btn2, '{{waybill_url}}', 'Print waybill')
      || format(f.st_h, 'What to do') || f.st_o
      || format(f.li, 'Print the label and stick it on the package.') || format(f.li, 'Print the waybill for your records.') || format(f.li, 'Have the parcel ready at your shop. A Fez rider will pick it up.') || f.st_c,
    '', format(f.h_portal, '{{portal_orders_url}}')
  from fmt f
  union all
  select 'vendor_fez_pickup_confirmed', 'Pickup confirmed', 'Fez has collected your parcel', '',
    'Fez has collected order ' || f.ordn || ' from your shop.',
    f.tbl_open || format(f.rw, 'Tracking number', '{{tracking_number}}') || f.tbl_close,
    format(f.para, 'No further action needed.') || format(f.para, 'JulineMart Operations'),
    f.h_info
  from fmt f
  -- Internal
  union all
  select 'vendor_application_alert', 'New vendor application', 'New vendor application', '',
    'New vendor application from {{applicant_name}} ({{store_name}}), {{applicant_email}}.',
    format(f.btn, '{{admin_url}}', 'Review application'),
    '', f.h_staff
  from fmt f
)
update public.email_templates t
set html_content = replace(replace(replace(replace(replace(replace(replace(sh.s,
      '@@TITLE@@', i.title), '@@HEADLINE@@', i.headline), '@@GREETING@@', i.greeting), '@@LEAD@@', i.lead),
      '@@BODY@@', i.body), '@@CLOSING@@', i.closing), '@@HELP@@', i.help),
    updated_at = now()
from items i, shell sh
where t.type = i.type;
