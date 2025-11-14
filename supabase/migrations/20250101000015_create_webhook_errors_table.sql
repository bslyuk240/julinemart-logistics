-- Migration: Create webhook_errors table for logging WooCommerce webhook failures
CREATE TABLE IF NOT EXISTS webhook_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  woocommerce_order_id TEXT,
  error_message TEXT,
  error_stack TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_errors_order ON webhook_errors(woocommerce_order_id);
CREATE INDEX IF NOT EXISTS idx_webhook_errors_created ON webhook_errors(created_at DESC);
