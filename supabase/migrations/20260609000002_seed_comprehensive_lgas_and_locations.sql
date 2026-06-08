-- ============================================================
-- Seed: Comprehensive LGAs for existing cities + new locations
-- Run AFTER 20260609000001_approved_vendor_locations_lga_to_array.sql
-- ============================================================
-- Uses ON CONFLICT (state, city) DO UPDATE so this is idempotent.
-- `lga` column (legacy) is set to the first LGA in the array.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. UPDATE EXISTING CITIES — set comprehensive lgas arrays
-- ─────────────────────────────────────────────────────────────

-- Delta: Warri
UPDATE approved_vendor_locations
  SET lgas = ARRAY['Warri South', 'Warri North', 'Warri South-West'],
      lga  = 'Warri South'
  WHERE state = 'Delta' AND city = 'Warri';

-- Delta: Effurun (sits in Uvwie LGA only)
UPDATE approved_vendor_locations
  SET lgas = ARRAY['Uvwie'],
      lga  = 'Uvwie'
  WHERE state = 'Delta' AND city = 'Effurun';

-- Delta: Asaba
UPDATE approved_vendor_locations
  SET lgas = ARRAY['Oshimili South', 'Oshimili North'],
      lga  = 'Oshimili South'
  WHERE state = 'Delta' AND city = 'Asaba';

-- Anambra: Onitsha
UPDATE approved_vendor_locations
  SET lgas = ARRAY['Onitsha North', 'Onitsha South'],
      lga  = 'Onitsha North'
  WHERE state = 'Anambra' AND city = 'Onitsha';

-- Lagos: Ikeja
UPDATE approved_vendor_locations
  SET lgas = ARRAY['Ikeja', 'Agege', 'Ifako-Ijaiye', 'Ojodu'],
      lga  = 'Ikeja'
  WHERE state = 'Lagos' AND city = 'Ikeja';

-- Lagos: Lekki
UPDATE approved_vendor_locations
  SET lgas = ARRAY['Eti-Osa'],
      lga  = 'Eti-Osa'
  WHERE state = 'Lagos' AND city = 'Lekki';

-- Lagos: Yaba
UPDATE approved_vendor_locations
  SET lgas = ARRAY['Lagos Mainland', 'Yaba'],
      lga  = 'Lagos Mainland'
  WHERE state = 'Lagos' AND city = 'Yaba';

-- Lagos: Surulere
UPDATE approved_vendor_locations
  SET lgas = ARRAY['Surulere'],
      lga  = 'Surulere'
  WHERE state = 'Lagos' AND city = 'Surulere';

-- FCT: Abuja
UPDATE approved_vendor_locations
  SET lgas = ARRAY['Municipal Area Council', 'Bwari', 'Kuje', 'Abaji'],
      lga  = 'Municipal Area Council'
  WHERE state = 'FCT' AND city = 'Abuja';

-- FCT: Gwagwalada
UPDATE approved_vendor_locations
  SET lgas = ARRAY['Gwagwalada'],
      lga  = 'Gwagwalada'
  WHERE state = 'FCT' AND city = 'Gwagwalada';

-- Rivers: Port Harcourt — merge Obio-Akpor in as an LGA
UPDATE approved_vendor_locations
  SET lgas = ARRAY['Port Harcourt', 'Obio-Akpor'],
      lga  = 'Port Harcourt'
  WHERE state = 'Rivers' AND city = 'Port Harcourt';

-- Rivers: delete the old standalone Obio-Akpor city row (now an LGA under PH)
DELETE FROM approved_vendor_locations
  WHERE state = 'Rivers' AND city = 'Obio-Akpor';


-- ─────────────────────────────────────────────────────────────
-- 2. NEW LOCATIONS
-- Template columns used throughout:
--   zone_id            → resolved by state
--   hub_id             → null (assign later in UI)
--   default_courier_id → Fez
--   fez_hub_name/addr  → set where known
-- ─────────────────────────────────────────────────────────────

-- ── DELTA (more cities) ──────────────────────────────────────
INSERT INTO approved_vendor_locations
  (state, city, lga, lgas, zone_id, hub_id, default_courier_id,
   fez_hub_name, fez_hub_address,
   supports_vendor_direct_fez, supports_vendor_to_hub, supports_local_delivery,
   vendor_pickup_surcharge, status, notes)
VALUES
(
  'Delta', 'Ughelli', 'Ughelli North',
  ARRAY['Ughelli North', 'Ughelli South'],
  (SELECT id FROM zones WHERE 'Delta' = ANY(states) LIMIT 1), NULL,
  (SELECT id FROM couriers WHERE code = 'fez' AND is_active = true LIMIT 1),
  NULL, NULL,
  true, false, false, 0, 'active', NULL
),
(
  'Delta', 'Sapele', 'Sapele',
  ARRAY['Sapele'],
  (SELECT id FROM zones WHERE 'Delta' = ANY(states) LIMIT 1), NULL,
  (SELECT id FROM couriers WHERE code = 'fez' AND is_active = true LIMIT 1),
  NULL, NULL,
  true, false, false, 0, 'active', NULL
),
(
  'Delta', 'Agbor', 'Ika South',
  ARRAY['Ika South', 'Ika North-East'],
  (SELECT id FROM zones WHERE 'Delta' = ANY(states) LIMIT 1), NULL,
  (SELECT id FROM couriers WHERE code = 'fez' AND is_active = true LIMIT 1),
  NULL, NULL,
  true, false, false, 0, 'active', NULL
),
(
  'Delta', 'Ozoro', 'Isoko North',
  ARRAY['Isoko North', 'Isoko South'],
  (SELECT id FROM zones WHERE 'Delta' = ANY(states) LIMIT 1), NULL,
  (SELECT id FROM couriers WHERE code = 'fez' AND is_active = true LIMIT 1),
  NULL, NULL,
  true, false, false, 0, 'active', NULL
)
ON CONFLICT (state, city) DO UPDATE
  SET lgas = EXCLUDED.lgas, lga = EXCLUDED.lga;


-- ── EDO ─────────────────────────────────────────────────────
INSERT INTO approved_vendor_locations
  (state, city, lga, lgas, zone_id, hub_id, default_courier_id,
   fez_hub_name, fez_hub_address,
   supports_vendor_direct_fez, supports_vendor_to_hub, supports_local_delivery,
   vendor_pickup_surcharge, status, notes)
VALUES
(
  'Edo', 'Benin City', 'Oredo',
  ARRAY['Oredo', 'Egor', 'Ikpoba-Okha', 'Ovia North-East'],
  (SELECT id FROM zones WHERE 'Edo' = ANY(states) LIMIT 1), NULL,
  (SELECT id FROM couriers WHERE code = 'fez' AND is_active = true LIMIT 1),
  NULL, NULL,
  true, false, false, 0, 'active', NULL
),
(
  'Edo', 'Auchi', 'Etsako West',
  ARRAY['Etsako West', 'Etsako Central', 'Etsako East'],
  (SELECT id FROM zones WHERE 'Edo' = ANY(states) LIMIT 1), NULL,
  (SELECT id FROM couriers WHERE code = 'fez' AND is_active = true LIMIT 1),
  NULL, NULL,
  true, false, false, 0, 'active', NULL
)
ON CONFLICT (state, city) DO UPDATE
  SET lgas = EXCLUDED.lgas, lga = EXCLUDED.lga;


-- ── BAYELSA ──────────────────────────────────────────────────
INSERT INTO approved_vendor_locations
  (state, city, lga, lgas, zone_id, hub_id, default_courier_id,
   fez_hub_name, fez_hub_address,
   supports_vendor_direct_fez, supports_vendor_to_hub, supports_local_delivery,
   vendor_pickup_surcharge, status, notes)
VALUES
(
  'Bayelsa', 'Yenagoa', 'Yenagoa',
  ARRAY['Yenagoa', 'Kolokuma/Opokuma'],
  (SELECT id FROM zones WHERE 'Bayelsa' = ANY(states) LIMIT 1), NULL,
  (SELECT id FROM couriers WHERE code = 'fez' AND is_active = true LIMIT 1),
  NULL, NULL,
  true, false, false, 0, 'active', NULL
)
ON CONFLICT (state, city) DO UPDATE
  SET lgas = EXCLUDED.lgas, lga = EXCLUDED.lga;


-- ── CROSS RIVER ──────────────────────────────────────────────
INSERT INTO approved_vendor_locations
  (state, city, lga, lgas, zone_id, hub_id, default_courier_id,
   fez_hub_name, fez_hub_address,
   supports_vendor_direct_fez, supports_vendor_to_hub, supports_local_delivery,
   vendor_pickup_surcharge, status, notes)
VALUES
(
  'Cross River', 'Calabar', 'Calabar Municipal',
  ARRAY['Calabar Municipal', 'Calabar South'],
  (SELECT id FROM zones WHERE 'Cross River' = ANY(states) LIMIT 1), NULL,
  (SELECT id FROM couriers WHERE code = 'fez' AND is_active = true LIMIT 1),
  NULL, NULL,
  true, false, false, 0, 'active', NULL
)
ON CONFLICT (state, city) DO UPDATE
  SET lgas = EXCLUDED.lgas, lga = EXCLUDED.lga;


-- ── AKWA IBOM ────────────────────────────────────────────────
INSERT INTO approved_vendor_locations
  (state, city, lga, lgas, zone_id, hub_id, default_courier_id,
   fez_hub_name, fez_hub_address,
   supports_vendor_direct_fez, supports_vendor_to_hub, supports_local_delivery,
   vendor_pickup_surcharge, status, notes)
VALUES
(
  'Akwa Ibom', 'Uyo', 'Uyo',
  ARRAY['Uyo', 'Ibesikpo Asutan', 'Uruan'],
  (SELECT id FROM zones WHERE 'Akwa Ibom' = ANY(states) LIMIT 1), NULL,
  (SELECT id FROM couriers WHERE code = 'fez' AND is_active = true LIMIT 1),
  NULL, NULL,
  true, false, false, 0, 'active', NULL
),
(
  'Akwa Ibom', 'Eket', 'Eket',
  ARRAY['Eket', 'Esit Eket', 'Ibeno'],
  (SELECT id FROM zones WHERE 'Akwa Ibom' = ANY(states) LIMIT 1), NULL,
  (SELECT id FROM couriers WHERE code = 'fez' AND is_active = true LIMIT 1),
  NULL, NULL,
  true, false, false, 0, 'active', NULL
)
ON CONFLICT (state, city) DO UPDATE
  SET lgas = EXCLUDED.lgas, lga = EXCLUDED.lga;


-- ── RIVERS (more cities) ─────────────────────────────────────
INSERT INTO approved_vendor_locations
  (state, city, lga, lgas, zone_id, hub_id, default_courier_id,
   fez_hub_name, fez_hub_address,
   supports_vendor_direct_fez, supports_vendor_to_hub, supports_local_delivery,
   vendor_pickup_surcharge, status, notes)
VALUES
(
  'Rivers', 'Bonny', 'Bonny',
  ARRAY['Bonny'],
  (SELECT id FROM zones WHERE 'Rivers' = ANY(states) LIMIT 1), NULL,
  (SELECT id FROM couriers WHERE code = 'fez' AND is_active = true LIMIT 1),
  NULL, NULL,
  true, false, false, 0, 'active', NULL
),
(
  'Rivers', 'Eleme', 'Eleme',
  ARRAY['Eleme'],
  (SELECT id FROM zones WHERE 'Rivers' = ANY(states) LIMIT 1), NULL,
  (SELECT id FROM couriers WHERE code = 'fez' AND is_active = true LIMIT 1),
  NULL, NULL,
  true, false, false, 0, 'active', NULL
)
ON CONFLICT (state, city) DO UPDATE
  SET lgas = EXCLUDED.lgas, lga = EXCLUDED.lga;


-- ── LAGOS (more areas) ───────────────────────────────────────
INSERT INTO approved_vendor_locations
  (state, city, lga, lgas, zone_id, hub_id, default_courier_id,
   fez_hub_name, fez_hub_address,
   supports_vendor_direct_fez, supports_vendor_to_hub, supports_local_delivery,
   vendor_pickup_surcharge, status, notes)
VALUES
(
  'Lagos', 'Lagos Island', 'Lagos Island',
  ARRAY['Lagos Island', 'Lagos Island East'],
  (SELECT id FROM zones WHERE 'Lagos' = ANY(states) LIMIT 1),
  (SELECT id FROM hubs WHERE LOWER(state) = 'lagos' AND is_active = true LIMIT 1),
  (SELECT id FROM couriers WHERE code = 'fez' AND is_active = true LIMIT 1),
  'Fez Lagos Hub', 'Fez Delivery Lagos Hub, Ikeja, Lagos',
  true, true, false, 500, 'active', NULL
),
(
  'Lagos', 'Victoria Island', 'Eti-Osa',
  ARRAY['Eti-Osa'],
  (SELECT id FROM zones WHERE 'Lagos' = ANY(states) LIMIT 1),
  (SELECT id FROM hubs WHERE LOWER(state) = 'lagos' AND is_active = true LIMIT 1),
  (SELECT id FROM couriers WHERE code = 'fez' AND is_active = true LIMIT 1),
  'Fez Lagos Hub', 'Fez Delivery Lagos Hub, Ikeja, Lagos',
  true, true, false, 500, 'active', NULL
),
(
  'Lagos', 'Ikorodu', 'Ikorodu',
  ARRAY['Ikorodu', 'Ikorodu North', 'Ikorodu West'],
  (SELECT id FROM zones WHERE 'Lagos' = ANY(states) LIMIT 1),
  (SELECT id FROM hubs WHERE LOWER(state) = 'lagos' AND is_active = true LIMIT 1),
  (SELECT id FROM couriers WHERE code = 'fez' AND is_active = true LIMIT 1),
  'Fez Lagos Hub', 'Fez Delivery Lagos Hub, Ikeja, Lagos',
  true, true, false, 500, 'active', NULL
),
(
  'Lagos', 'Alimosho', 'Alimosho',
  ARRAY['Alimosho', 'Agbado/Oke-Odo'],
  (SELECT id FROM zones WHERE 'Lagos' = ANY(states) LIMIT 1),
  (SELECT id FROM hubs WHERE LOWER(state) = 'lagos' AND is_active = true LIMIT 1),
  (SELECT id FROM couriers WHERE code = 'fez' AND is_active = true LIMIT 1),
  'Fez Lagos Hub', 'Fez Delivery Lagos Hub, Ikeja, Lagos',
  true, true, false, 500, 'active', NULL
),
(
  'Lagos', 'Badagry', 'Badagry',
  ARRAY['Badagry', 'Badagry West'],
  (SELECT id FROM zones WHERE 'Lagos' = ANY(states) LIMIT 1),
  (SELECT id FROM hubs WHERE LOWER(state) = 'lagos' AND is_active = true LIMIT 1),
  (SELECT id FROM couriers WHERE code = 'fez' AND is_active = true LIMIT 1),
  'Fez Lagos Hub', 'Fez Delivery Lagos Hub, Ikeja, Lagos',
  true, false, false, 500, 'active', NULL
),
(
  'Lagos', 'Epe', 'Epe',
  ARRAY['Epe', 'Ibeju-Lekki'],
  (SELECT id FROM zones WHERE 'Lagos' = ANY(states) LIMIT 1),
  (SELECT id FROM hubs WHERE LOWER(state) = 'lagos' AND is_active = true LIMIT 1),
  (SELECT id FROM couriers WHERE code = 'fez' AND is_active = true LIMIT 1),
  'Fez Lagos Hub', 'Fez Delivery Lagos Hub, Ikeja, Lagos',
  true, false, false, 500, 'active', NULL
)
ON CONFLICT (state, city) DO UPDATE
  SET lgas = EXCLUDED.lgas, lga = EXCLUDED.lga;


-- ── OGUN ─────────────────────────────────────────────────────
INSERT INTO approved_vendor_locations
  (state, city, lga, lgas, zone_id, hub_id, default_courier_id,
   fez_hub_name, fez_hub_address,
   supports_vendor_direct_fez, supports_vendor_to_hub, supports_local_delivery,
   vendor_pickup_surcharge, status, notes)
VALUES
(
  'Ogun', 'Abeokuta', 'Abeokuta North',
  ARRAY['Abeokuta North', 'Abeokuta South', 'Obafemi-Owode'],
  (SELECT id FROM zones WHERE 'Ogun' = ANY(states) LIMIT 1), NULL,
  (SELECT id FROM couriers WHERE code = 'fez' AND is_active = true LIMIT 1),
  NULL, NULL,
  true, false, false, 0, 'active', NULL
),
(
  'Ogun', 'Sagamu', 'Sagamu',
  ARRAY['Sagamu', 'Remo North'],
  (SELECT id FROM zones WHERE 'Ogun' = ANY(states) LIMIT 1), NULL,
  (SELECT id FROM couriers WHERE code = 'fez' AND is_active = true LIMIT 1),
  NULL, NULL,
  true, false, false, 0, 'active', NULL
),
(
  'Ogun', 'Ijebu-Ode', 'Ijebu Ode',
  ARRAY['Ijebu Ode', 'Ijebu East', 'Ijebu North'],
  (SELECT id FROM zones WHERE 'Ogun' = ANY(states) LIMIT 1), NULL,
  (SELECT id FROM couriers WHERE code = 'fez' AND is_active = true LIMIT 1),
  NULL, NULL,
  true, false, false, 0, 'active', NULL
),
(
  'Ogun', 'Ota', 'Ado-Odo/Ota',
  ARRAY['Ado-Odo/Ota', 'Ifo'],
  (SELECT id FROM zones WHERE 'Ogun' = ANY(states) LIMIT 1), NULL,
  (SELECT id FROM couriers WHERE code = 'fez' AND is_active = true LIMIT 1),
  NULL, NULL,
  true, false, false, 0, 'active', NULL
)
ON CONFLICT (state, city) DO UPDATE
  SET lgas = EXCLUDED.lgas, lga = EXCLUDED.lga;


-- ── OYO ──────────────────────────────────────────────────────
INSERT INTO approved_vendor_locations
  (state, city, lga, lgas, zone_id, hub_id, default_courier_id,
   fez_hub_name, fez_hub_address,
   supports_vendor_direct_fez, supports_vendor_to_hub, supports_local_delivery,
   vendor_pickup_surcharge, status, notes)
VALUES
(
  'Oyo', 'Ibadan', 'Ibadan North',
  ARRAY['Ibadan North', 'Ibadan North-East', 'Ibadan North-West', 'Ibadan South-East', 'Ibadan South-West', 'Egbeda', 'Ona-Ara'],
  (SELECT id FROM zones WHERE 'Oyo' = ANY(states) LIMIT 1), NULL,
  (SELECT id FROM couriers WHERE code = 'fez' AND is_active = true LIMIT 1),
  NULL, NULL,
  true, false, false, 0, 'active', NULL
),
(
  'Oyo', 'Ogbomosho', 'Ogbomosho North',
  ARRAY['Ogbomosho North', 'Ogbomosho South', 'Surulere'],
  (SELECT id FROM zones WHERE 'Oyo' = ANY(states) LIMIT 1), NULL,
  (SELECT id FROM couriers WHERE code = 'fez' AND is_active = true LIMIT 1),
  NULL, NULL,
  true, false, false, 0, 'active', NULL
),
(
  'Oyo', 'Oyo', 'Oyo East',
  ARRAY['Oyo East', 'Oyo West', 'Atiba'],
  (SELECT id FROM zones WHERE 'Oyo' = ANY(states) LIMIT 1), NULL,
  (SELECT id FROM couriers WHERE code = 'fez' AND is_active = true LIMIT 1),
  NULL, NULL,
  true, false, false, 0, 'active', NULL
)
ON CONFLICT (state, city) DO UPDATE
  SET lgas = EXCLUDED.lgas, lga = EXCLUDED.lga;


-- ── OSUN ─────────────────────────────────────────────────────
INSERT INTO approved_vendor_locations
  (state, city, lga, lgas, zone_id, hub_id, default_courier_id,
   fez_hub_name, fez_hub_address,
   supports_vendor_direct_fez, supports_vendor_to_hub, supports_local_delivery,
   vendor_pickup_surcharge, status, notes)
VALUES
(
  'Osun', 'Osogbo', 'Olorunda',
  ARRAY['Olorunda', 'Osogbo', 'Egbedore'],
  (SELECT id FROM zones WHERE 'Osun' = ANY(states) LIMIT 1), NULL,
  (SELECT id FROM couriers WHERE code = 'fez' AND is_active = true LIMIT 1),
  NULL, NULL,
  true, false, false, 0, 'active', NULL
),
(
  'Osun', 'Ile-Ife', 'Ife Central',
  ARRAY['Ife Central', 'Ife East', 'Ife North', 'Ife South'],
  (SELECT id FROM zones WHERE 'Osun' = ANY(states) LIMIT 1), NULL,
  (SELECT id FROM couriers WHERE code = 'fez' AND is_active = true LIMIT 1),
  NULL, NULL,
  true, false, false, 0, 'active', NULL
),
(
  'Osun', 'Ilesa', 'Ilesa East',
  ARRAY['Ilesa East', 'Ilesa West', 'Oriade'],
  (SELECT id FROM zones WHERE 'Osun' = ANY(states) LIMIT 1), NULL,
  (SELECT id FROM couriers WHERE code = 'fez' AND is_active = true LIMIT 1),
  NULL, NULL,
  true, false, false, 0, 'active', NULL
)
ON CONFLICT (state, city) DO UPDATE
  SET lgas = EXCLUDED.lgas, lga = EXCLUDED.lga;


-- ── ONDO ─────────────────────────────────────────────────────
INSERT INTO approved_vendor_locations
  (state, city, lga, lgas, zone_id, hub_id, default_courier_id,
   fez_hub_name, fez_hub_address,
   supports_vendor_direct_fez, supports_vendor_to_hub, supports_local_delivery,
   vendor_pickup_surcharge, status, notes)
VALUES
(
  'Ondo', 'Akure', 'Akure South',
  ARRAY['Akure South', 'Akure North'],
  (SELECT id FROM zones WHERE 'Ondo' = ANY(states) LIMIT 1), NULL,
  (SELECT id FROM couriers WHERE code = 'fez' AND is_active = true LIMIT 1),
  NULL, NULL,
  true, false, false, 0, 'active', NULL
),
(
  'Ondo', 'Ondo City', 'Ondo West',
  ARRAY['Ondo West', 'Ondo East'],
  (SELECT id FROM zones WHERE 'Ondo' = ANY(states) LIMIT 1), NULL,
  (SELECT id FROM couriers WHERE code = 'fez' AND is_active = true LIMIT 1),
  NULL, NULL,
  true, false, false, 0, 'active', NULL
),
(
  'Ondo', 'Owo', 'Owo',
  ARRAY['Owo', 'Ose'],
  (SELECT id FROM zones WHERE 'Ondo' = ANY(states) LIMIT 1), NULL,
  (SELECT id FROM couriers WHERE code = 'fez' AND is_active = true LIMIT 1),
  NULL, NULL,
  true, false, false, 0, 'active', NULL
)
ON CONFLICT (state, city) DO UPDATE
  SET lgas = EXCLUDED.lgas, lga = EXCLUDED.lga;


-- ── EKITI ────────────────────────────────────────────────────
INSERT INTO approved_vendor_locations
  (state, city, lga, lgas, zone_id, hub_id, default_courier_id,
   fez_hub_name, fez_hub_address,
   supports_vendor_direct_fez, supports_vendor_to_hub, supports_local_delivery,
   vendor_pickup_surcharge, status, notes)
VALUES
(
  'Ekiti', 'Ado-Ekiti', 'Ado',
  ARRAY['Ado', 'Irepodun/Ifelodun', 'Ekiti East'],
  (SELECT id FROM zones WHERE 'Ekiti' = ANY(states) LIMIT 1), NULL,
  (SELECT id FROM couriers WHERE code = 'fez' AND is_active = true LIMIT 1),
  NULL, NULL,
  true, false, false, 0, 'active', NULL
)
ON CONFLICT (state, city) DO UPDATE
  SET lgas = EXCLUDED.lgas, lga = EXCLUDED.lga;


-- ── ANAMBRA (more cities) ────────────────────────────────────
INSERT INTO approved_vendor_locations
  (state, city, lga, lgas, zone_id, hub_id, default_courier_id,
   fez_hub_name, fez_hub_address,
   supports_vendor_direct_fez, supports_vendor_to_hub, supports_local_delivery,
   vendor_pickup_surcharge, status, notes)
VALUES
(
  'Anambra', 'Awka', 'Awka South',
  ARRAY['Awka South', 'Awka North', 'Anaocha'],
  (SELECT id FROM zones WHERE 'Anambra' = ANY(states) LIMIT 1), NULL,
  (SELECT id FROM couriers WHERE code = 'fez' AND is_active = true LIMIT 1),
  NULL, NULL,
  true, false, false, 0, 'active', NULL
),
(
  'Anambra', 'Nnewi', 'Nnewi North',
  ARRAY['Nnewi North', 'Nnewi South', 'Ekwusigo'],
  (SELECT id FROM zones WHERE 'Anambra' = ANY(states) LIMIT 1), NULL,
  (SELECT id FROM couriers WHERE code = 'fez' AND is_active = true LIMIT 1),
  NULL, NULL,
  true, false, false, 0, 'active', NULL
)
ON CONFLICT (state, city) DO UPDATE
  SET lgas = EXCLUDED.lgas, lga = EXCLUDED.lga;


-- ── IMO ──────────────────────────────────────────────────────
INSERT INTO approved_vendor_locations
  (state, city, lga, lgas, zone_id, hub_id, default_courier_id,
   fez_hub_name, fez_hub_address,
   supports_vendor_direct_fez, supports_vendor_to_hub, supports_local_delivery,
   vendor_pickup_surcharge, status, notes)
VALUES
(
  'Imo', 'Owerri', 'Owerri Municipal',
  ARRAY['Owerri Municipal', 'Owerri North', 'Owerri West'],
  (SELECT id FROM zones WHERE 'Imo' = ANY(states) LIMIT 1), NULL,
  (SELECT id FROM couriers WHERE code = 'fez' AND is_active = true LIMIT 1),
  NULL, NULL,
  true, false, false, 0, 'active', NULL
),
(
  'Imo', 'Orlu', 'Orlu',
  ARRAY['Orlu', 'Oru East', 'Oru West', 'Orsu'],
  (SELECT id FROM zones WHERE 'Imo' = ANY(states) LIMIT 1), NULL,
  (SELECT id FROM couriers WHERE code = 'fez' AND is_active = true LIMIT 1),
  NULL, NULL,
  true, false, false, 0, 'active', NULL
),
(
  'Imo', 'Okigwe', 'Okigwe',
  ARRAY['Okigwe', 'Onuimo', 'Ihitte/Uboma'],
  (SELECT id FROM zones WHERE 'Imo' = ANY(states) LIMIT 1), NULL,
  (SELECT id FROM couriers WHERE code = 'fez' AND is_active = true LIMIT 1),
  NULL, NULL,
  true, false, false, 0, 'active', NULL
)
ON CONFLICT (state, city) DO UPDATE
  SET lgas = EXCLUDED.lgas, lga = EXCLUDED.lga;


-- ── ENUGU ────────────────────────────────────────────────────
INSERT INTO approved_vendor_locations
  (state, city, lga, lgas, zone_id, hub_id, default_courier_id,
   fez_hub_name, fez_hub_address,
   supports_vendor_direct_fez, supports_vendor_to_hub, supports_local_delivery,
   vendor_pickup_surcharge, status, notes)
VALUES
(
  'Enugu', 'Enugu', 'Enugu North',
  ARRAY['Enugu North', 'Enugu South', 'Enugu East', 'Nkanu West'],
  (SELECT id FROM zones WHERE 'Enugu' = ANY(states) LIMIT 1), NULL,
  (SELECT id FROM couriers WHERE code = 'fez' AND is_active = true LIMIT 1),
  NULL, NULL,
  true, false, false, 0, 'active', NULL
),
(
  'Enugu', 'Nsukka', 'Nsukka',
  ARRAY['Nsukka', 'Igbo-Eze North', 'Igbo-Eze South', 'Uzo-Uwani'],
  (SELECT id FROM zones WHERE 'Enugu' = ANY(states) LIMIT 1), NULL,
  (SELECT id FROM couriers WHERE code = 'fez' AND is_active = true LIMIT 1),
  NULL, NULL,
  true, false, false, 0, 'active', NULL
)
ON CONFLICT (state, city) DO UPDATE
  SET lgas = EXCLUDED.lgas, lga = EXCLUDED.lga;


-- ── ABIA ─────────────────────────────────────────────────────
INSERT INTO approved_vendor_locations
  (state, city, lga, lgas, zone_id, hub_id, default_courier_id,
   fez_hub_name, fez_hub_address,
   supports_vendor_direct_fez, supports_vendor_to_hub, supports_local_delivery,
   vendor_pickup_surcharge, status, notes)
VALUES
(
  'Abia', 'Aba', 'Aba North',
  ARRAY['Aba North', 'Aba South', 'Osisioma Ngwa'],
  (SELECT id FROM zones WHERE 'Abia' = ANY(states) LIMIT 1), NULL,
  (SELECT id FROM couriers WHERE code = 'fez' AND is_active = true LIMIT 1),
  NULL, NULL,
  true, false, false, 0, 'active', NULL
),
(
  'Abia', 'Umuahia', 'Umuahia North',
  ARRAY['Umuahia North', 'Umuahia South', 'Ikwuano'],
  (SELECT id FROM zones WHERE 'Abia' = ANY(states) LIMIT 1), NULL,
  (SELECT id FROM couriers WHERE code = 'fez' AND is_active = true LIMIT 1),
  NULL, NULL,
  true, false, false, 0, 'active', NULL
)
ON CONFLICT (state, city) DO UPDATE
  SET lgas = EXCLUDED.lgas, lga = EXCLUDED.lga;


-- ── EBONYI ───────────────────────────────────────────────────
INSERT INTO approved_vendor_locations
  (state, city, lga, lgas, zone_id, hub_id, default_courier_id,
   fez_hub_name, fez_hub_address,
   supports_vendor_direct_fez, supports_vendor_to_hub, supports_local_delivery,
   vendor_pickup_surcharge, status, notes)
VALUES
(
  'Ebonyi', 'Abakaliki', 'Abakaliki',
  ARRAY['Abakaliki', 'Ebonyi', 'Izzi'],
  (SELECT id FROM zones WHERE 'Ebonyi' = ANY(states) LIMIT 1), NULL,
  (SELECT id FROM couriers WHERE code = 'fez' AND is_active = true LIMIT 1),
  NULL, NULL,
  true, false, false, 0, 'active', NULL
)
ON CONFLICT (state, city) DO UPDATE
  SET lgas = EXCLUDED.lgas, lga = EXCLUDED.lga;
