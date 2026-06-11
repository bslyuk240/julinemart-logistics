-- Staff-created shipment emails for vendors outside JLO hub areas

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
  'vendor_shipment_ready_fez_pickup','vendor_shipment_ready_fez_hub'
]));

INSERT INTO email_templates (name, type, subject, html_content, text_content, is_active)
VALUES
(
  'Vendor Shipment Ready Fez Pickup',
  'vendor_shipment_ready_fez_pickup',
  'Order #{{order_number}} — label ready (Fez pickup from your shop)',
  '<!DOCTYPE html><html><body style="font-family:sans-serif;color:#333;max-width:600px;margin:0 auto;padding:24px">
  <h2 style="color:#7c3aed">Shipment created — print your label</h2>
  <p>Hi {{vendor_name}},</p>
  <p>JulineMart has created the Fez shipment for order <strong>#{{order_number}}</strong>.</p>
  <div style="background:#f3f4f6;border-radius:8px;padding:16px;margin:20px 0">
    <p style="margin:0 0 8px 0"><strong>Tracking number:</strong></p>
    <p style="margin:0;font-family:monospace;font-size:16px">{{tracking_number}}</p>
    <p style="margin:12px 0 0 0"><a href="{{label_url}}" style="color:#7c3aed;font-weight:600">Print shipping label</a></p>
  </div>
  <p><strong>What to do:</strong></p>
  <ol>
    <li>Print the label and stick it on the package</li>
    <li>Have the parcel ready at your shop — a Fez rider will pick it up</li>
  </ol>
  <p style="font-size:13px;color:#888">View in portal: <a href="{{portal_orders_url}}">{{portal_orders_url}}</a></p>
  </body></html>',
  'Order #{{order_number}} — tracking {{tracking_number}}. Print label: {{label_url}}. Have parcel ready at your shop for Fez pickup.',
  true
),
(
  'Vendor Shipment Ready Fez Hub',
  'vendor_shipment_ready_fez_hub',
  'Order #{{order_number}} — label ready (drop at Fez hub)',
  '<!DOCTYPE html><html><body style="font-family:sans-serif;color:#333;max-width:600px;margin:0 auto;padding:24px">
  <h2 style="color:#7c3aed">Shipment created — print your label</h2>
  <p>Hi {{vendor_name}},</p>
  <p>JulineMart has created the Fez shipment for order <strong>#{{order_number}}</strong>.</p>
  <div style="background:#f3f4f6;border-radius:8px;padding:16px;margin:20px 0">
    <p style="margin:0 0 8px 0"><strong>Tracking number:</strong></p>
    <p style="margin:0;font-family:monospace;font-size:16px">{{tracking_number}}</p>
    <p style="margin:12px 0 0 0"><a href="{{label_url}}" style="color:#7c3aed;font-weight:600">Print shipping label</a></p>
  </div>
  <p><strong>Drop-off location:</strong> {{hub_name}}<br/>{{hub_address}}</p>
  <p><strong>What to do:</strong></p>
  <ol>
    <li>Print the label and stick it on the package</li>
    <li>Drop the parcel at the Fez hub above</li>
  </ol>
  <p style="font-size:13px;color:#888">View in portal: <a href="{{portal_orders_url}}">{{portal_orders_url}}</a></p>
  </body></html>',
  'Order #{{order_number}} — tracking {{tracking_number}}. Print label: {{label_url}}. Drop at {{hub_name}}, {{hub_address}}.',
  true
);
