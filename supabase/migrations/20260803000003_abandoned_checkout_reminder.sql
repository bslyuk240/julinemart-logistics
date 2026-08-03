-- Abandoned-checkout reminder: email template + per-order dedup column.
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
  'abandoned_checkout_reminder'
]));

INSERT INTO email_templates (name, type, subject, html_content, text_content, is_active)
VALUES (
  'Abandoned Checkout Reminder',
  'abandoned_checkout_reminder',
  'You left something in your cart, {{customerName}}',
  '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Complete your order - JulineMart</title>
<style>
  body { margin:0; padding:0; font-family: -apple-system, BlinkMacSystemFont, ''Segoe UI'', Roboto, ''Helvetica Neue'', Arial, sans-serif; background-color:#f5f5f5; line-height:1.6; }
  .email-container { max-width:600px; margin:0 auto; background-color:#ffffff; }
  .header { background: linear-gradient(135deg, #7c3aed 0%, #a855f7 100%); padding:20px; text-align:center; }
  .header img { width:40px; height:40px; }
  .header h1 { color:#ffffff; margin:10px 0 0; font-size:18px; }
  .content { padding:24px 20px; }
  .greeting { font-size:15px; color:#1f2937; margin-bottom:10px; font-weight:600; }
  .message { color:#4b5563; font-size:14px; margin-bottom:16px; }
  .order-box { background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border-left:3px solid #f97316; padding:14px; border-radius:6px; margin-bottom:16px; }
  .order-value { font-size:16px; color:#1f2937; font-weight:700; }
  .cta-button { display:inline-block; background: linear-gradient(135deg, #7c3aed 0%, #a855f7 100%); color:#ffffff !important; padding:12px 24px; text-decoration:none; border-radius:6px; font-weight:600; font-size:14px; margin:8px 0; }
  .footer { background-color:#f9fafb; padding:16px; text-align:center; border-top:2px solid #7c3aed; }
  .footer-text { color:#9ca3af; font-size:11px; }
  .footer-text a { color:#9ca3af; }
</style></head>
<body>
  <div class="email-container">
    <div class="header">
      <img src="https://res.cloudinary.com/dupgdbwrt/image/upload/v1759968430/icon-192.png_fukoim.png" alt="JulineMart">
      <h1>Still thinking it over?</h1>
    </div>
    <div class="content">
      <p class="greeting">Hi {{customerName}},</p>
      <p class="message">You started an order on JulineMart but didn''t finish checking out. Your cart is still waiting for you.</p>
      <div class="order-box">
        <div class="order-value">Order #{{orderNumber}} — NGN {{totalAmount}}</div>
      </div>
      <center><a href="{{cartUrl}}" class="cta-button">Finish my order</a></center>
    </div>
    <div class="footer">
      <p class="footer-text">JulineMart - Nigeria''s Trusted Marketplace</p>
      <p class="footer-text"><a href="{{unsubscribeUrl}}">Unsubscribe from these reminders</a></p>
    </div>
  </div>
</body></html>',
  'Hi {{customerName}}, you started order #{{orderNumber}} (NGN {{totalAmount}}) on JulineMart but didn''t finish checking out. Finish it here: {{cartUrl}}

Unsubscribe from these reminders: {{unsubscribeUrl}}',
  true
);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS abandoned_reminder_sent_at timestamptz NULL;
