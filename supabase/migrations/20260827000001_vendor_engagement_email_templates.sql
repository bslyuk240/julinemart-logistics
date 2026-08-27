-- Vendor engagement emails: welcome, activation reminder, monthly sales,
-- campaign invitation, and profile-update reminder.

ALTER TABLE email_templates DROP CONSTRAINT IF EXISTS email_templates_type_check;
ALTER TABLE email_templates ADD CONSTRAINT email_templates_type_check CHECK (type = ANY (ARRAY[
  'influencer_report','order_cancelled','order_confirmation','order_processing',
  'order_shipped','out_for_delivery','order_delivered','refund_completed',
  'return_rejected','return_request_received','vendor_fez_pickup_confirmed',
  'vendor_order_fez_pickup','vendor_order_hub_dropoff','vendor_waitlist_activation',
  'vendor_waitlist_confirmation','support_chat_staff_alert','support_chat_customer_receipt',
  'vendor_application_received','vendor_application_rejected','vendor_application_alert',
  'contact_form',
  'return_admin_alert','return_vendor_alert','return_approved',
  'return_in_transit','return_delivered_to_hub','refund_failed',
  'vendor_shipment_ready_fez_pickup','vendor_shipment_ready_fez_hub',
  'abandoned_checkout_reminder','product_view_winback',
  'vendor_activation_reminder','vendor_welcome','vendor_monthly_sales_report',
  'vendor_promotional_campaign','vendor_account_update'
]));

INSERT INTO email_templates (name, type, subject, html_content, text_content, variables, is_active)
VALUES

(
  'Vendor Activation Reminder',
  'vendor_activation_reminder',
  'Kickstart Your Sales on JulineMart Today!',
  $html$<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 16px;"><tr><td align="center"><table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;max-width:560px;width:100%;"><tr><td style="background:linear-gradient(135deg,#77088a,#4a0558);padding:32px 40px;text-align:center;"><h1 style="color:#ffffff;margin:0;font-size:22px;font-weight:700;">JulineMart</h1><p style="color:rgba(255,255,255,0.75);margin:6px 0 0;font-size:13px;">Vendor Partner Programme</p></td></tr><tr><td style="padding:36px 40px;"><p style="color:#111827;font-size:16px;margin:0 0 16px;">Hi <strong>{{vendor_name}}</strong>,</p><p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 20px;">Your store <strong>{{store_name}}</strong> is approved, but you have not listed products yet. Neighbours on JulineMart are already browsing — listing even a few items puts you in front of them.</p><table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;"><tr><td style="background:#f5f0ff;border-radius:10px;padding:20px 24px;"><p style="color:#5b21b6;font-size:13px;font-weight:700;margin:0 0 12px;text-transform:uppercase;letter-spacing:0.5px;">Get selling in three steps</p><p style="color:#4c1d95;font-size:14px;margin:0 0 8px;line-height:1.5;">1. Add your first product with a photo, price, and stock</p><p style="color:#4c1d95;font-size:14px;margin:0 0 8px;line-height:1.5;">2. Confirm your pickup or hub drop-off details</p><p style="color:#4c1d95;font-size:14px;margin:0;line-height:1.5;">3. Publish — shoppers can order the same day</p></td></tr></table><p style="text-align:center;margin:0 0 24px;"><a href="{{portal_products_url}}" style="display:inline-block;background:#77088a;color:#ffffff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;">List your products →</a></p><p style="color:#6b7280;font-size:14px;line-height:1.6;margin:0;">Need a hand? Email <a href="mailto:{{support_email}}" style="color:#77088a;">{{support_email}}</a>.</p></td></tr><tr><td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:20px 40px;text-align:center;"><p style="color:#9ca3af;font-size:12px;margin:0;">© 2026 JulineMart · <a href="https://julinemart.com" style="color:#77088a;text-decoration:none;">julinemart.com</a></p></td></tr></table></td></tr></table></body></html>$html$,
  $text$Hi {{vendor_name}},

Your store {{store_name}} is approved on JulineMart, but you have not listed products yet.

List your first items here: {{portal_products_url}}

Questions? Email {{support_email}}

— The JulineMart Team$text$,
  '["vendor_name","store_name","portal_products_url","support_email"]'::jsonb,
  true
),

(
  'New Vendor Welcome',
  'vendor_welcome',
  'Welcome to JulineMart!',
  $html$<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 16px;"><tr><td align="center"><table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;max-width:560px;width:100%;"><tr><td style="background:linear-gradient(135deg,#77088a,#4a0558);padding:32px 40px;text-align:center;"><h1 style="color:#ffffff;margin:0;font-size:22px;font-weight:700;">Welcome to JulineMart</h1><p style="color:rgba(255,255,255,0.75);margin:6px 0 0;font-size:13px;">Vendor Partner Programme</p></td></tr><tr><td style="padding:36px 40px;"><p style="color:#111827;font-size:16px;margin:0 0 16px;">Hi <strong>{{vendor_name}}</strong>,</p><p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 20px;"><strong>{{store_name}}</strong> is approved. You can now sell to neighbours on JulineMart. Check your inbox for the password setup email, then follow the steps below.</p><table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;"><tr><td style="background:#f5f0ff;border-radius:10px;padding:20px 24px;"><p style="color:#5b21b6;font-size:13px;font-weight:700;margin:0 0 12px;text-transform:uppercase;letter-spacing:0.5px;">Your first week</p><p style="color:#4c1d95;font-size:14px;margin:0 0 8px;line-height:1.5;">1. Set your password from the invite email</p><p style="color:#4c1d95;font-size:14px;margin:0 0 8px;line-height:1.5;">2. Confirm store, bank, and pickup details in Settings</p><p style="color:#4c1d95;font-size:14px;margin:0;line-height:1.5;">3. List products with clear photos and prices</p></td></tr></table><p style="text-align:center;margin:0 0 24px;"><a href="{{portal_url}}" style="display:inline-block;background:#77088a;color:#ffffff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;">Open vendor portal →</a></p><p style="color:#6b7280;font-size:14px;line-height:1.6;margin:0;">Questions? Email <a href="mailto:{{support_email}}" style="color:#77088a;">{{support_email}}</a>.</p></td></tr><tr><td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:20px 40px;text-align:center;"><p style="color:#9ca3af;font-size:12px;margin:0;">© 2026 JulineMart · <a href="https://julinemart.com" style="color:#77088a;text-decoration:none;">julinemart.com</a></p></td></tr></table></td></tr></table></body></html>$html$,
  $text$Hi {{vendor_name}},

{{store_name}} is approved on JulineMart. Check your inbox for the password setup email, then:

1. Set your password
2. Confirm store, bank, and pickup details
3. List your first products

Vendor portal: {{portal_url}}

Questions? Email {{support_email}}

— The JulineMart Team$text$,
  '["vendor_name","store_name","portal_url","support_email"]'::jsonb,
  true
),

(
  'Monthly Sales Report',
  'vendor_monthly_sales_report',
  'Your Monthly Sales Overview',
  $html$<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 16px;"><tr><td align="center"><table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;max-width:560px;width:100%;"><tr><td style="background:linear-gradient(135deg,#77088a,#4a0558);padding:32px 40px;text-align:center;"><h1 style="color:#ffffff;margin:0;font-size:22px;font-weight:700;">Your monthly sales</h1><p style="color:rgba(255,255,255,0.75);margin:6px 0 0;font-size:13px;">{{month_label}} · {{store_name}}</p></td></tr><tr><td style="padding:36px 40px;"><p style="color:#111827;font-size:16px;margin:0 0 16px;">Hi <strong>{{vendor_name}}</strong>,</p><p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 20px;">Here is how {{store_name}} performed on JulineMart last month.</p><table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;"><tr><td style="padding:14px 20px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:13px;">Paid orders</td><td style="padding:14px 20px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700;color:#111827;">{{order_count}}</td></tr><tr><td style="padding:14px 20px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:13px;">Gross sales</td><td style="padding:14px 20px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700;color:#111827;">₦{{gross_sales}}</td></tr><tr><td style="padding:14px 20px;color:#6b7280;font-size:13px;">Net earnings</td><td style="padding:14px 20px;text-align:right;font-weight:700;color:#77088a;">₦{{net_earnings}}</td></tr></table><p style="text-align:center;margin:0 0 24px;"><a href="{{portal_earnings_url}}" style="display:inline-block;background:#77088a;color:#ffffff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;">View earnings →</a></p><p style="color:#6b7280;font-size:14px;line-height:1.6;margin:0;">Net earnings are after the JulineMart commission. Voucher discounts are covered by JulineMart, not deducted from you.</p></td></tr><tr><td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:20px 40px;text-align:center;"><p style="color:#9ca3af;font-size:12px;margin:0;">© 2026 JulineMart · <a href="https://julinemart.com" style="color:#77088a;text-decoration:none;">julinemart.com</a></p></td></tr></table></td></tr></table></body></html>$html$,
  $text$Hi {{vendor_name}},

{{store_name}} sales for {{month_label}}:

Paid orders: {{order_count}}
Gross sales: ₦{{gross_sales}}
Net earnings: ₦{{net_earnings}}

View earnings: {{portal_earnings_url}}

— The JulineMart Team$text$,
  '["vendor_name","store_name","month_label","order_count","gross_sales","net_earnings","portal_earnings_url"]'::jsonb,
  true
),

(
  'Promotional Campaign Invitation',
  'vendor_promotional_campaign',
  'Join Our Upcoming Campaign!',
  $html$<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 16px;"><tr><td align="center"><table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;max-width:560px;width:100%;"><tr><td style="background:linear-gradient(135deg,#77088a,#4a0558);padding:32px 40px;text-align:center;"><h1 style="color:#ffffff;margin:0;font-size:22px;font-weight:700;">Join our upcoming campaign</h1><p style="color:rgba(255,255,255,0.75);margin:6px 0 0;font-size:13px;">Vendor Partner Programme</p></td></tr><tr><td style="padding:36px 40px;"><p style="color:#111827;font-size:16px;margin:0 0 16px;">Hi <strong>{{vendor_name}}</strong>,</p><p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 20px;">We are inviting {{store_name}} to take part in <strong>{{campaign_name}}</strong>. Featured products get extra visibility with shoppers on JulineMart.</p><table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;"><tr><td style="background:#f5f0ff;border-radius:10px;padding:20px 24px;"><p style="color:#5b21b6;font-size:13px;font-weight:700;margin:0 0 8px;text-transform:uppercase;letter-spacing:0.5px;">{{campaign_name}}</p><p style="color:#4c1d95;font-size:14px;margin:0 0 8px;line-height:1.5;"><strong>When:</strong> {{campaign_dates}}</p><p style="color:#4c1d95;font-size:14px;margin:0;line-height:1.5;">{{campaign_details}}</p></td></tr></table><p style="text-align:center;margin:0 0 24px;"><a href="{{join_url}}" style="display:inline-block;background:#77088a;color:#ffffff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;">Join the campaign →</a></p><p style="color:#6b7280;font-size:14px;line-height:1.6;margin:0;">Spots are limited. Reply or use the button above if you want in.</p></td></tr><tr><td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:20px 40px;text-align:center;"><p style="color:#9ca3af;font-size:12px;margin:0;">© 2026 JulineMart · <a href="https://julinemart.com" style="color:#77088a;text-decoration:none;">julinemart.com</a></p></td></tr></table></td></tr></table></body></html>$html$,
  $text$Hi {{vendor_name}},

We are inviting {{store_name}} to join {{campaign_name}}.

When: {{campaign_dates}}
{{campaign_details}}

Join here: {{join_url}}

— The JulineMart Team$text$,
  '["vendor_name","store_name","campaign_name","campaign_dates","campaign_details","join_url"]'::jsonb,
  true
),

(
  'Vendor Account Update',
  'vendor_account_update',
  'Please Update Your Vendor Profile',
  $html$<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 16px;"><tr><td align="center"><table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;max-width:560px;width:100%;"><tr><td style="background:linear-gradient(135deg,#77088a,#4a0558);padding:32px 40px;text-align:center;"><h1 style="color:#ffffff;margin:0;font-size:22px;font-weight:700;">Update your vendor profile</h1><p style="color:rgba(255,255,255,0.75);margin:6px 0 0;font-size:13px;">Vendor Partner Programme</p></td></tr><tr><td style="padding:36px 40px;"><p style="color:#111827;font-size:16px;margin:0 0 16px;">Hi <strong>{{vendor_name}}</strong>,</p><p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 20px;">Please review the details for <strong>{{store_name}}</strong>. Accurate store, bank, and pickup information keeps payouts and deliveries on track.</p><table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;"><tr><td style="background:#f5f0ff;border-radius:10px;padding:20px 24px;"><p style="color:#5b21b6;font-size:13px;font-weight:700;margin:0 0 12px;text-transform:uppercase;letter-spacing:0.5px;">Please confirm</p><p style="color:#4c1d95;font-size:14px;margin:0 0 8px;line-height:1.5;">Store name, phone, and address</p><p style="color:#4c1d95;font-size:14px;margin:0 0 8px;line-height:1.5;">Bank account for payouts</p><p style="color:#4c1d95;font-size:14px;margin:0;line-height:1.5;">Pickup or hub drop-off method</p></td></tr></table><p style="text-align:center;margin:0 0 24px;"><a href="{{portal_settings_url}}" style="display:inline-block;background:#77088a;color:#ffffff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;">Update profile →</a></p><p style="color:#6b7280;font-size:14px;line-height:1.6;margin:0;">Questions? Email <a href="mailto:{{support_email}}" style="color:#77088a;">{{support_email}}</a>.</p></td></tr><tr><td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:20px 40px;text-align:center;"><p style="color:#9ca3af;font-size:12px;margin:0;">© 2026 JulineMart · <a href="https://julinemart.com" style="color:#77088a;text-decoration:none;">julinemart.com</a></p></td></tr></table></td></tr></table></body></html>$html$,
  $text$Hi {{vendor_name}},

Please review the profile for {{store_name}}: store details, bank account, and pickup method.

Update here: {{portal_settings_url}}

Questions? Email {{support_email}}

— The JulineMart Team$text$,
  '["vendor_name","store_name","portal_settings_url","support_email"]'::jsonb,
  true
)

ON CONFLICT (name) DO UPDATE SET
  type         = EXCLUDED.type,
  subject      = EXCLUDED.subject,
  html_content = EXCLUDED.html_content,
  text_content = EXCLUDED.text_content,
  variables    = EXCLUDED.variables,
  is_active    = EXCLUDED.is_active,
  updated_at   = now();
