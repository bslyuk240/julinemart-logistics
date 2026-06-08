-- Migration: convert approved_vendor_locations.lga (text) → lgas (text[])
-- Each city now has one row with multiple LGAs instead of one row per LGA.

-- 1. Add new lgas column
ALTER TABLE approved_vendor_locations
  ADD COLUMN IF NOT EXISTS lgas text[] NOT NULL DEFAULT '{}';

-- 2. Migrate existing single-lga rows → single-element arrays
UPDATE approved_vendor_locations
  SET lgas = ARRAY[lga]
  WHERE lga IS NOT NULL AND (lgas IS NULL OR lgas = '{}');

-- 3. Drop old unique constraint on (state, city, lga) — various possible names
DO $$
BEGIN
  BEGIN
    ALTER TABLE approved_vendor_locations DROP CONSTRAINT approved_vendor_locations_state_city_lga_key;
  EXCEPTION WHEN undefined_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE approved_vendor_locations DROP CONSTRAINT uq_approved_vendor_locations_state_city_lga;
  EXCEPTION WHEN undefined_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE approved_vendor_locations DROP CONSTRAINT approved_vendor_locations_pkey;
  EXCEPTION WHEN undefined_object THEN NULL;
  END;
END $$;

-- 4. Add unique constraint on (state, city) — one row per city going forward
-- (skip if it already exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_approved_vendor_locations_state_city'
  ) THEN
    ALTER TABLE approved_vendor_locations
      ADD CONSTRAINT uq_approved_vendor_locations_state_city UNIQUE (state, city);
  END IF;
END $$;

-- 5. Drop old lga column (keep as last step; comment out if you want to keep it temporarily)
-- ALTER TABLE approved_vendor_locations DROP COLUMN IF EXISTS lga;
-- NOTE: Run the DROP COLUMN manually after confirming all code is deployed and working.
