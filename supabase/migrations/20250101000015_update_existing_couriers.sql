 Add API integration columns to existing couriers
-- This updates your 3 existing couriers: Fez Delivery, GIGL, Kwik

-- Update Fez Delivery with API configuration
UPDATE couriers 
SET 
  api_enabled = false,
  api_base_url = 'https://api.fezdispatch.com/v1',
  api_key_encrypted = NULL,
  api_secret_encrypted = NULL,
  api_config = '{}'::jsonb,
  supports_live_tracking = true,
  supports_label_generation = true,
  supports_rate_calculation = false,
  webhook_url = NULL,
  last_api_sync = NULL
WHERE code = 'FEZ' OR name = 'Fez Delivery';

-- Update GIGL with API placeholders (for future use)
UPDATE couriers 
SET 
  api_enabled = false,
  api_base_url = 'https://api.gigl.com/v1', -- Replace with actual URL when available
  api_key_encrypted = NULL,
  api_secret_encrypted = NULL,
  api_config = '{}'::jsonb,
  supports_live_tracking = true,
  supports_label_generation = true,
  supports_rate_calculation = false,
  webhook_url = NULL,
  last_api_sync = NULL
WHERE code = 'GIGL' OR name ILIKE '%gigl%';

-- Update Kwik with API placeholders (for future use)
UPDATE couriers 
SET 
  api_enabled = false,
  api_base_url = 'https://api.kwik.delivery/v1', -- Replace with actual URL when available
  api_key_encrypted = NULL,
  api_secret_encrypted = NULL,
  api_config = '{}'::jsonb,
  supports_live_tracking = true,
  supports_label_generation = true,
  supports_rate_calculation = false,
  webhook_url = NULL,
  last_api_sync = NULL
WHERE code = 'KWIK' OR name ILIKE '%kwik%';

-- Verify the updates
SELECT 
  id,
  name,
  code,
  type,
  api_enabled,
  api_base_url,
  supports_live_tracking,
  supports_label_generation,
  is_active
FROM couriers
ORDER BY name;

-- Show success message
SELECT 'API fields updated for all couriers!' as status;
