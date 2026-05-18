-- Rename refund_wc_id → paystack_refund_id now that WooCommerce is no longer used
ALTER TABLE return_requests
  RENAME COLUMN refund_wc_id TO paystack_refund_id;
