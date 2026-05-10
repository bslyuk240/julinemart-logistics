-- ============================================================
-- Email templates for vendor location / waitlist flows
-- ============================================================

INSERT INTO email_templates (name, subject, html_content, text_content, is_active)
VALUES

-- 1. Waitlist confirmation (sent when vendor joins waitlist)
(
  'Vendor Waitlist Confirmation',
  'You''re on the JulineMart vendor waitlist — {{city}}, {{state}}',
  '<!DOCTYPE html><html><body style="font-family:sans-serif;color:#333;max-width:600px;margin:0 auto;padding:24px">
  <h2 style="color:#7c3aed">You''re on the waitlist!</h2>
  <p>Hi {{vendor_name}},</p>
  <p>Thank you for your interest in becoming a JulineMart vendor.</p>
  <p>JulineMart is not yet onboarding vendors from <strong>{{city}}, {{lga}}, {{state}}</strong> — but you are now on our waitlist.</p>
  <p>We will send you an email as soon as your area becomes active. When that happens, you will be able to register and start selling immediately.</p>
  <p style="margin-top:24px;font-size:13px;color:#888">Questions? Contact us at <a href="mailto:{{support_email}}">{{support_email}}</a></p>
  <p style="font-size:13px;color:#888">— The JulineMart Team</p>
  </body></html>',
  'Hi {{vendor_name}},

You are on the JulineMart vendor waitlist for {{city}}, {{lga}}, {{state}}.

We will notify you as soon as your area becomes active.

Questions? Email {{support_email}}

— The JulineMart Team',
  true
),

-- 2. City activation (sent when admin makes a city live)
(
  'Vendor Waitlist Activation',
  'Great news — JulineMart is now live in {{city}}, {{state}}!',
  '<!DOCTYPE html><html><body style="font-family:sans-serif;color:#333;max-width:600px;margin:0 auto;padding:24px">
  <h2 style="color:#7c3aed">Your city is now live!</h2>
  <p>Hi {{vendor_name}},</p>
  <p>Great news — JulineMart is now accepting vendor registrations from <strong>{{city}}, {{lga}}, {{state}}</strong>!</p>
  <p>You joined our waitlist and we promised to let you know. Now is your chance.</p>
  <a href="{{registration_url}}" style="display:inline-block;margin:20px 0;background:#7c3aed;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600">
    Register Now →
  </a>
  <p style="font-size:13px;color:#888">This link takes you directly to the vendor registration form.</p>
  <p style="font-size:13px;color:#888">Questions? Email <a href="mailto:{{support_email}}">{{support_email}}</a></p>
  <p style="font-size:13px;color:#888">— The JulineMart Team</p>
  </body></html>',
  'Hi {{vendor_name}},

JulineMart is now live in {{city}}, {{lga}}, {{state}}!

Register here: {{registration_url}}

Questions? Email {{support_email}}

— The JulineMart Team',
  true
),

-- 3. Vendor order — Fez pickup instruction
(
  'Vendor Order Fez Pickup',
  'New order #{{order_number}} — Fez will collect from your shop',
  '<!DOCTYPE html><html><body style="font-family:sans-serif;color:#333;max-width:600px;margin:0 auto;padding:24px">
  <h2 style="color:#7c3aed">New Order — Prepare for Fez Pickup</h2>
  <p>Hi {{vendor_name}},</p>
  <p>You have a new order <strong>#{{order_number}}</strong>.</p>
  <p>Your collection method is set to <strong>Fez pickup</strong>. A Fez rider will come to your shop to collect this parcel.</p>
  <div style="background:#f3f4f6;border-radius:8px;padding:16px;margin:20px 0">
    <p style="margin:0 0 8px 0"><strong>What to do:</strong></p>
    <ol style="margin:0;padding-left:20px">
      <li>Pack the items securely</li>
      <li>Go to your vendor portal → Orders</li>
      <li>Click <strong>Send to Fez</strong> to create the shipment</li>
      <li>Print the label and stick it on the package</li>
      <li>Have the parcel ready at your address for Fez collection</li>
    </ol>
  </div>
  <p style="font-size:13px;color:#888">Order total: {{order_total}} | Items: {{item_count}}</p>
  <p style="font-size:13px;color:#888">— JulineMart Operations</p>
  </body></html>',
  'New order #{{order_number}} — Fez will pick up from your shop.

Pack the items, go to your portal, click Send to Fez, print the label, and have the parcel ready.

— JulineMart Operations',
  true
),

-- 4. Vendor order — Hub drop-off instruction
(
  'Vendor Order Hub Dropoff',
  'New order #{{order_number}} — Drop off at Fez hub',
  '<!DOCTYPE html><html><body style="font-family:sans-serif;color:#333;max-width:600px;margin:0 auto;padding:24px">
  <h2 style="color:#7c3aed">New Order — Drop Off at Fez Hub</h2>
  <p>Hi {{vendor_name}},</p>
  <p>You have a new order <strong>#{{order_number}}</strong>.</p>
  <p>Your collection method is set to <strong>hub drop-off</strong>. Please bring this parcel to your nearest Fez collection hub.</p>
  <div style="background:#f3f4f6;border-radius:8px;padding:16px;margin:20px 0">
    <p style="margin:0 0 8px 0"><strong>Drop-off location:</strong></p>
    <p style="margin:0;font-weight:600">{{fez_hub_name}}</p>
    <p style="margin:4px 0 0 0;color:#555">{{fez_hub_address}}</p>
  </div>
  <div style="background:#f3f4f6;border-radius:8px;padding:16px;margin:20px 0">
    <p style="margin:0 0 8px 0"><strong>What to do:</strong></p>
    <ol style="margin:0;padding-left:20px">
      <li>Pack the items securely</li>
      <li>Go to your vendor portal → Orders</li>
      <li>Click <strong>Send to Fez</strong> to create the shipment</li>
      <li>Print the label and stick it on the package</li>
      <li>Drop the package at the Fez hub address above</li>
    </ol>
  </div>
  <p style="font-size:13px;color:#888">Order total: {{order_total}} | Items: {{item_count}}</p>
  <p style="font-size:13px;color:#888">— JulineMart Operations</p>
  </body></html>',
  'New order #{{order_number}} — drop off at {{fez_hub_name}}, {{fez_hub_address}}.

Pack, create shipment in portal, print label, and drop off.

— JulineMart Operations',
  true
),

-- 5. Vendor Fez pickup confirmed (webhook: Picked-Up status)
(
  'Vendor Fez Pickup Confirmed',
  'Fez has collected order #{{order_number}} from your shop',
  '<!DOCTYPE html><html><body style="font-family:sans-serif;color:#333;max-width:600px;margin:0 auto;padding:24px">
  <h2 style="color:#16a34a">Parcel Collected ✓</h2>
  <p>Hi {{vendor_name}},</p>
  <p>Fez has successfully collected order <strong>#{{order_number}}</strong> from your shop.</p>
  <p>Tracking number: <strong style="font-family:monospace">{{tracking_number}}</strong></p>
  <p>The parcel is now in transit to the customer. No further action is needed from you.</p>
  <p style="font-size:13px;color:#888">— JulineMart Operations</p>
  </body></html>',
  'Fez has collected order #{{order_number}} from your shop. Tracking: {{tracking_number}}. No further action needed.

— JulineMart Operations',
  true
)

ON CONFLICT (name) DO UPDATE SET
  subject      = EXCLUDED.subject,
  html_content = EXCLUDED.html_content,
  text_content = EXCLUDED.text_content,
  is_active    = EXCLUDED.is_active;
