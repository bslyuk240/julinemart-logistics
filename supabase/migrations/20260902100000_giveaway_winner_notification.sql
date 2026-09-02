-- Winner notification: a dedicated link field (rather than deriving one from
-- the grand-prize voucher's own product/vendor/category scoping, which may
-- not resolve to a single product page at all) so the winner email can point
-- straight at the prize.
alter table campaigns add column grand_prize_product_url text;
comment on column campaigns.grand_prize_product_url is 'Giveaway only. Product page link sent to the drawn winner in their notification email — set independently of the grand-prize voucher''s own scoping.';

-- email_templates.type has a whitelist CHECK constraint — widen it for the
-- new template type before inserting.
alter table email_templates drop constraint email_templates_type_check;
alter table email_templates add constraint email_templates_type_check check (type = any (array[
  'influencer_report', 'order_cancelled', 'order_confirmation', 'order_processing',
  'order_shipped', 'out_for_delivery', 'order_delivered', 'refund_completed',
  'return_rejected', 'return_request_received', 'vendor_fez_pickup_confirmed',
  'vendor_order_fez_pickup', 'vendor_order_hub_dropoff', 'vendor_waitlist_activation',
  'vendor_waitlist_confirmation', 'support_chat_staff_alert', 'support_chat_customer_receipt',
  'vendor_application_received', 'vendor_application_rejected', 'vendor_application_alert',
  'contact_form', 'return_admin_alert', 'return_vendor_alert', 'return_approved',
  'return_in_transit', 'return_delivered_to_hub', 'refund_failed',
  'vendor_shipment_ready_fez_pickup', 'vendor_shipment_ready_fez_hub',
  'abandoned_checkout_reminder', 'product_view_winback', 'vendor_activation_reminder',
  'vendor_welcome', 'vendor_monthly_sales_report', 'vendor_promotional_campaign',
  'vendor_account_update', 'giveaway_winner'
]));

-- Seeded once via migration, matching how internal_whatsapp_templates rows
-- were seeded — editable afterward through the existing /api/email/templates
-- admin tooling like any other template.
insert into email_templates (name, type, subject, html_content, text_content, variables, is_active)
values (
  'Giveaway Winner Announcement',
  'giveaway_winner',
  '🎉 You won the {{campaignTitle}} giveaway!',
  '<div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #1b1024;">
    <h1 style="color: #2a103b;">Congratulations, {{winnerName}}! 🎉</h1>
    <p>You were the randomly selected winner of <strong>{{campaignTitle}}</strong> — the prize is <strong>{{prizeDescription}}</strong>.</p>
    <div style="background: #f7edd8; border-radius: 12px; padding: 20px; text-align: center; margin: 24px 0;">
      <p style="margin: 0 0 8px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; color: #5c4d68;">Your prize code</p>
      <p style="margin: 0; font-family: monospace; font-size: 22px; font-weight: 700; letter-spacing: 0.08em; color: #2a103b;">{{voucherCode}}</p>
    </div>
    <p>Use this code at checkout to claim your prize. It only applies to the giveaway item.</p>
    <p style="text-align: center; margin: 28px 0;">
      <a href="{{productUrl}}" style="background: #d9480f; color: #ffffff; padding: 14px 28px; border-radius: 999px; text-decoration: none; font-weight: 700; display: inline-block;">Claim Your Prize</a>
    </p>
    <p style="font-size: 13px; color: #5c4d68;">Our team will also be in touch on WhatsApp to confirm delivery details.</p>
  </div>',
  'Congratulations, {{winnerName}}!

You were the randomly selected winner of {{campaignTitle}} — the prize is {{prizeDescription}}.

Your prize code: {{voucherCode}}

Claim it here: {{productUrl}}

Our team will also be in touch on WhatsApp to confirm delivery details.',
  '["winnerName", "campaignTitle", "prizeDescription", "voucherCode", "productUrl"]'::jsonb,
  true
);
