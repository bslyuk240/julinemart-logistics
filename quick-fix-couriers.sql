-- Quick fix: Add type to existing couriers (if type column exists and is null)
UPDATE couriers SET type = 'standard' WHERE type IS NULL;

-- Now update with API configuration
UPDATE couriers 
SET 
  api_enabled = false,
  api_base_url = 'https://api.fezdispatch.com/v1',
  supports_live_tracking = true,
  supports_label_generation = true
WHERE code = 'FEZ' OR name = 'Fez Delivery';

UPDATE couriers 
SET 
  api_enabled = false,
  api_base_url = 'https://api.gigl.com/v1',
  supports_live_tracking = true,
  supports_label_generation = true
WHERE code = 'GIGL' OR name ILIKE '%gigl%';

UPDATE couriers 
SET 
  api_enabled = false,
  api_base_url = 'https://api.kwik.delivery/v1',
  supports_live_tracking = true,
  supports_label_generation = true
WHERE code = 'KWIK' OR name ILIKE '%kwik%';

-- Verify
SELECT 
  id,
  name,
  code,
  type,
  api_enabled,
  api_base_url,
  supports_live_tracking,
  supports_label_generation
FROM couriers
ORDER BY name;
