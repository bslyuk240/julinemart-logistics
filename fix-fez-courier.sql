-- First, let's check what type values are expected
SELECT DISTINCT type FROM couriers WHERE type IS NOT NULL;

-- If the above returns nothing, we'll add Fez with a default type
-- Update the existing Fez record or insert with type
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
  'standard', -- Adding type field
  false,
  'https://api.fezdispatch.com/v1',
  true,
  true,
  true
)
ON CONFLICT (code) DO UPDATE SET
  type = EXCLUDED.type,
  api_base_url = EXCLUDED.api_base_url,
  api_enabled = EXCLUDED.api_enabled,
  supports_live_tracking = EXCLUDED.supports_live_tracking,
  supports_label_generation = EXCLUDED.supports_label_generation;

-- Verify it worked
SELECT id, name, code, type, api_enabled, api_base_url FROM couriers WHERE code = 'FEZ';
