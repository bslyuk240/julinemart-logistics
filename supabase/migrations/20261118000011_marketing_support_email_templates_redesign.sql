-- Redesign the last six emails: abandoned checkout, product win-back,
-- giveaway winner, influencer report, support-chat receipt and staff alert
-- (same layout as 20261118000008-10). html_content changes everywhere; the
-- only subject change is dropping the emoji from the giveaway winner subject.
-- Unsubscribe links are kept. Pre-change copy: backup.email_templates_20261118.
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
<td style="padding-top:24px;font-size:13px;line-height:1.7;color:#6b6472;">@@HELP@@</td>
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
fmt(rw, tbl_open, tbl_close, g, btn, para, ordn, h_info, h_staff, h_unsub, h_mail) as (
  select
    '<tr><td style="padding:13px 0;border-bottom:1px solid #e7e1e9;font-size:14px;color:#6b6472;width:130px;vertical-align:top;">%s</td><td style="padding:13px 0;border-bottom:1px solid #e7e1e9;font-size:15px;font-weight:600;color:#1f1424;">%s</td></tr>',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e7e1e9;margin:0 0 28px;">',
    '</table>',
    '<p style="margin:0 0 12px;font-size:16px;line-height:1.6;font-weight:600;color:#1f1424;">Hi %s,</p>',
    '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 12px;"><tr><td style="background:#670779;border-radius:2px;"><a href="%s" style="display:inline-block;padding:15px 32px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;">%s</a></td></tr></table>',
    '<p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#3d3543;">%s</p>',
    '<strong style="color:#670779;">#{{orderNumber}}</strong>',
    'Need a hand? Write to <a href="mailto:info@julinemart.com" style="color:#670779;">info@julinemart.com</a>.',
    'Internal notice for the JulineMart team. Please do not forward.',
    '<a href="https://julinemart.com" style="color:#670779;">Continue shopping</a><br><a href="{{unsubscribeUrl}}" style="color:#6b6472;">%s</a>',
    'Questions? Write to us at <a href="mailto:%1$s" style="color:#670779;">%1$s</a>.'
),
items(type, subj, title, headline, greeting, lead, body, closing, help) as (
  select 'abandoned_checkout_reminder', null::text, 'You left something behind', 'You left something in your cart',
    format(f.g, '{{customerName}}'),
    'You started order ' || f.ordn || ' on JulineMart but didn''t finish checking out.',
    f.tbl_open || format(f.rw, 'Order total', 'NGN {{totalAmount}}') || f.tbl_close || format(f.btn, '{{cartUrl}}', 'Complete your order'),
    '', format(f.h_unsub, 'Unsubscribe from these reminders')
  from fmt f
  union all
  select 'product_view_winback', null, 'Still thinking about it?', 'Still thinking about {{productName}}?',
    format(f.g, '{{customerName}}'),
    'You checked out {{productName}} on JulineMart recently, and it''s still available.',
    f.tbl_open || format(f.rw, 'Price', 'NGN {{productPrice}}') || f.tbl_close || format(f.btn, '{{productUrl}}', 'View product'),
    '', format(f.h_unsub, 'Unsubscribe from these emails')
  from fmt f
  union all
  select 'giveaway_winner', 'You won the {{campaignTitle}} giveaway!', 'You won', 'You won the {{campaignTitle}} giveaway',
    format(f.g, '{{winnerName}}'),
    'Congratulations! You were the randomly selected winner of {{campaignTitle}}. The prize is {{prizeDescription}}.',
    f.tbl_open || format(f.rw, 'Your prize code', '<span style="font-family:Consolas,Menlo,monospace;letter-spacing:1px;">{{voucherCode}}</span>') || f.tbl_close
      || format(f.btn, '{{productUrl}}', 'Claim your prize'),
    format(f.para, 'Our team will also be in touch on WhatsApp to confirm delivery details.'), f.h_info
  from fmt f
  union all
  select 'influencer_report', null, 'Sales update', 'Your sales update for {{periodLabel}}',
    format(f.g, '{{influencerName}}'),
    'Here''s your performance summary for {{periodLabel}}. You had {{ordersCount}} orders.',
    f.tbl_open || format(f.rw, 'Total sales', 'NGN {{totalSales}}') || format(f.rw, 'Total commission', 'NGN {{totalCommission}}')
      || format(f.rw, 'Pending commission', 'NGN {{pendingCommission}}') || format(f.rw, 'Paid commission', 'NGN {{paidCommission}}') || f.tbl_close,
    format(f.para, 'Generated on {{generatedAt}}.'), f.h_info
  from fmt f
  union all
  select 'support_chat_customer_receipt', null, 'We got your message', 'We got your message',
    format(f.g, '{{customer_name}}'),
    'Thank you for reaching out to JulineMart Support. We received your message:',
    f.tbl_open || format(f.rw, 'Your message', '&ldquo;{{first_message}}&rdquo;') || f.tbl_close,
    format(f.para, 'We typically reply within a few hours.') || format(f.para, 'The JulineMart Support Team'),
    format(f.h_mail, '{{support_email}}')
  from fmt f
  union all
  select 'support_chat_staff_alert', null, 'New support chat', 'New support chat from {{customer_name}}',
    '',
    'A customer is waiting for a reply.',
    f.tbl_open || format(f.rw, 'Customer', '{{customer_name}}') || format(f.rw, 'Email', '{{customer_email}}') || format(f.rw, 'Time', '{{requested_at}}')
      || format(f.rw, 'First message', '&ldquo;{{first_message}}&rdquo;') || f.tbl_close
      || format(f.btn, '{{inbox_url}}', 'Open inbox'),
    '', f.h_staff
  from fmt f
)
update public.email_templates t
set subject = coalesce(i.subj, t.subject),
    html_content = replace(replace(replace(replace(replace(replace(replace(sh.s,
      '@@TITLE@@', i.title), '@@HEADLINE@@', i.headline), '@@GREETING@@', i.greeting), '@@LEAD@@', i.lead),
      '@@BODY@@', i.body), '@@CLOSING@@', i.closing), '@@HELP@@', i.help),
    updated_at = now()
from items i, shell sh
where t.type = i.type;
