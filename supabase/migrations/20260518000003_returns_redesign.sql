-- Returns redesign: admin-initiated shipments, multi-destination, email templates

ALTER TABLE return_requests ADD COLUMN IF NOT EXISTS rejection_reason text;

ALTER TABLE return_shipments
  ADD COLUMN IF NOT EXISTS vendor_id uuid REFERENCES vendors(id),
  ADD COLUMN IF NOT EXISTS destination_type text CHECK (destination_type IN ('hub', 'vendor')),
  ADD COLUMN IF NOT EXISTS destination_address jsonb,
  ADD COLUMN IF NOT EXISTS label_url text;

ALTER TABLE email_templates DROP CONSTRAINT IF EXISTS email_templates_type_check;
ALTER TABLE email_templates ADD CONSTRAINT email_templates_type_check CHECK (type = ANY (ARRAY[
  'influencer_report','order_cancelled','order_confirmation','order_delivered',
  'order_processing','order_shipped','out_for_delivery','refund_completed',
  'return_rejected','return_request_received','vendor_fez_pickup_confirmed',
  'vendor_order_fez_pickup','vendor_order_hub_dropoff','vendor_waitlist_activation',
  'vendor_waitlist_confirmation','support_chat_staff_alert','support_chat_customer_receipt',
  'vendor_application_received','vendor_application_rejected','vendor_application_alert',
  'contact_form',
  'return_admin_alert','return_vendor_alert','return_approved',
  'return_in_transit','return_delivered_to_hub','refund_failed'
]));
