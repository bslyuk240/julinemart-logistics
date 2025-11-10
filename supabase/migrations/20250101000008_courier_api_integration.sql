-- =====================================================
-- Add API configuration columns to couriers table
-- =====================================================

ALTER TABLE couriers 
ADD COLUMN IF NOT EXISTS api_enabled boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS api_base_url text,
ADD COLUMN IF NOT EXISTS api_key_encrypted text,
ADD COLUMN IF NOT EXISTS api_secret_encrypted text,
ADD COLUMN IF NOT EXISTS api_config jsonb DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS supports_live_tracking boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS supports_label_generation boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS supports_rate_calculation boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS webhook_url text,
ADD COLUMN IF NOT EXISTS last_api_sync timestamp with time zone;

-- =====================================================
-- Create courier_api_logs table for debugging
-- =====================================================

CREATE TABLE IF NOT EXISTS courier_api_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  courier_id uuid REFERENCES couriers(id) ON DELETE CASCADE,
  request_type text NOT NULL,
  request_payload jsonb,
  response_payload jsonb,
  status_code integer,
  success boolean,
  error_message text,
  created_at timestamp with time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_courier_api_logs_courier ON courier_api_logs(courier_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_courier_api_logs_created ON courier_api_logs(created_at DESC);

-- =====================================================
-- Add tracking integration fields to sub_orders
-- =====================================================

ALTER TABLE sub_orders
ADD COLUMN IF NOT EXISTS courier_shipment_id text,
ADD COLUMN IF NOT EXISTS courier_tracking_url text,
ADD COLUMN IF NOT EXISTS waybill_url text,
ADD COLUMN IF NOT EXISTS label_url text,
ADD COLUMN IF NOT EXISTS last_tracking_update timestamp with time zone;

-- =====================================================
-- Insert Fez Delivery configuration (ready for API credentials)
-- =====================================================

INSERT INTO couriers (
  name, 
  code, 
  type, 
  api_enabled, 
  api_base_url, 
  supports_live_tracking, 
  supports_label_generation, 
  is_active
)
VALUES (
  'Fez Delivery',
  'FEZ',
  'fez',
  false, -- Will be set to true when credentials are added
  'https://api.fezdispatch.com/v1', -- Replace with actual Fez API URL
  true,
  true,
  true
)
ON CONFLICT (code) DO UPDATE SET
  type = EXCLUDED.type,
  api_base_url = EXCLUDED.api_base_url,
  supports_live_tracking = EXCLUDED.supports_live_tracking,
  supports_label_generation = EXCLUDED.supports_label_generation,
  updated_at = now();


COMMENT ON TABLE courier_api_logs IS 'Logs all courier API requests for debugging and monitoring';
COMMENT ON COLUMN couriers.api_enabled IS 'Whether API integration is active for this courier';
COMMENT ON COLUMN couriers.api_config IS 'Additional courier-specific API configuration';

SELECT 'Courier API schema created successfully!' as status;
