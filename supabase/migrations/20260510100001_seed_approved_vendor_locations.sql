-- ============================================================
-- Seed: Initial Approved Vendor Locations
-- These are the first cities JulineMart supports for vendor
-- onboarding. Zone IDs and hub IDs must be resolved at runtime
-- via the subqueries below — no hardcoded UUIDs.
-- ============================================================

-- Delta State — Hub-based delivery (Warri hub)
INSERT INTO approved_vendor_locations
    (state, city, lga, zone_id, hub_id, default_courier_id,
     fez_hub_name, fez_hub_address,
     supports_vendor_direct_fez, supports_vendor_to_hub, supports_local_delivery,
     vendor_pickup_surcharge, status, notes)
VALUES
(
    'Delta', 'Warri', 'Warri South',
    (SELECT id FROM zones WHERE 'Delta' = ANY(states) LIMIT 1),
    (SELECT id FROM hubs WHERE LOWER(city) = 'warri' AND is_active = true LIMIT 1),
    (SELECT id FROM couriers WHERE code = 'fez' AND is_active = true LIMIT 1),
    'Fez Warri Hub', 'Enerhen Road, Warri, Delta State',
    false, true, true,
    0, 'active',
    'Hub-first location. Vendors drop at Warri hub or use local delivery.'
),
(
    'Delta', 'Effurun', 'Uvwie',
    (SELECT id FROM zones WHERE 'Delta' = ANY(states) LIMIT 1),
    (SELECT id FROM hubs WHERE LOWER(city) = 'warri' AND is_active = true LIMIT 1),
    (SELECT id FROM couriers WHERE code = 'fez' AND is_active = true LIMIT 1),
    'Fez Warri Hub', 'Enerhen Road, Warri, Delta State',
    false, true, true,
    0, 'active',
    'Served by Warri hub. Vendor-to-hub and local delivery supported.'
)
ON CONFLICT (state, city, lga) DO NOTHING;

-- Lagos State — Vendor direct Fez
INSERT INTO approved_vendor_locations
    (state, city, lga, zone_id, hub_id, default_courier_id,
     fez_hub_name, fez_hub_address,
     supports_vendor_direct_fez, supports_vendor_to_hub, supports_local_delivery,
     vendor_pickup_surcharge, status, notes)
VALUES
(
    'Lagos', 'Ikeja', 'Ikeja',
    (SELECT id FROM zones WHERE 'Lagos' = ANY(states) LIMIT 1),
    (SELECT id FROM hubs WHERE LOWER(state) = 'lagos' AND is_active = true LIMIT 1),
    (SELECT id FROM couriers WHERE code = 'fez' AND is_active = true LIMIT 1),
    'Fez Lagos Hub', 'Fez Delivery Lagos Hub, Ikeja, Lagos',
    true, true, false,
    500, 'active',
    'Vendor direct Fez pickup available. ₦500 surcharge for door pickup.'
),
(
    'Lagos', 'Lekki', 'Eti-Osa',
    (SELECT id FROM zones WHERE 'Lagos' = ANY(states) LIMIT 1),
    (SELECT id FROM hubs WHERE LOWER(state) = 'lagos' AND is_active = true LIMIT 1),
    (SELECT id FROM couriers WHERE code = 'fez' AND is_active = true LIMIT 1),
    'Fez Lagos Hub', 'Fez Delivery Lagos Hub, Ikeja, Lagos',
    true, true, false,
    500, 'active',
    'Vendor direct Fez pickup available. ₦500 surcharge for door pickup.'
),
(
    'Lagos', 'Yaba', 'Lagos Mainland',
    (SELECT id FROM zones WHERE 'Lagos' = ANY(states) LIMIT 1),
    (SELECT id FROM hubs WHERE LOWER(state) = 'lagos' AND is_active = true LIMIT 1),
    (SELECT id FROM couriers WHERE code = 'fez' AND is_active = true LIMIT 1),
    'Fez Lagos Hub', 'Fez Delivery Lagos Hub, Ikeja, Lagos',
    true, true, false,
    500, 'active',
    'Vendor direct Fez pickup available.'
),
(
    'Lagos', 'Surulere', 'Lagos Mainland',
    (SELECT id FROM zones WHERE 'Lagos' = ANY(states) LIMIT 1),
    (SELECT id FROM hubs WHERE LOWER(state) = 'lagos' AND is_active = true LIMIT 1),
    (SELECT id FROM couriers WHERE code = 'fez' AND is_active = true LIMIT 1),
    'Fez Lagos Hub', 'Fez Delivery Lagos Hub, Ikeja, Lagos',
    true, true, false,
    500, 'active',
    'Vendor direct Fez pickup available.'
)
ON CONFLICT (state, city, lga) DO NOTHING;

-- FCT Abuja
INSERT INTO approved_vendor_locations
    (state, city, lga, zone_id, hub_id, default_courier_id,
     fez_hub_name, fez_hub_address,
     supports_vendor_direct_fez, supports_vendor_to_hub, supports_local_delivery,
     vendor_pickup_surcharge, status, notes)
VALUES
(
    'FCT', 'Abuja', 'Municipal Area Council',
    (SELECT id FROM zones WHERE 'FCT' = ANY(states) OR 'Abuja' = ANY(states) LIMIT 1),
    (SELECT id FROM hubs WHERE LOWER(city) LIKE '%abuja%' AND is_active = true LIMIT 1),
    (SELECT id FROM couriers WHERE code = 'fez' AND is_active = true LIMIT 1),
    'Fez Abuja Hub', 'Fez Delivery Abuja Hub, Wuse, Abuja',
    true, true, false,
    500, 'active',
    'Vendor direct Fez pickup available.'
),
(
    'FCT', 'Gwagwalada', 'Gwagwalada',
    (SELECT id FROM zones WHERE 'FCT' = ANY(states) OR 'Abuja' = ANY(states) LIMIT 1),
    (SELECT id FROM hubs WHERE LOWER(city) LIKE '%abuja%' AND is_active = true LIMIT 1),
    (SELECT id FROM couriers WHERE code = 'fez' AND is_active = true LIMIT 1),
    'Fez Abuja Hub', 'Fez Delivery Abuja Hub, Wuse, Abuja',
    true, true, false,
    500, 'active',
    'Served by Abuja hub.'
)
ON CONFLICT (state, city, lga) DO NOTHING;

-- Rivers State — Port Harcourt
INSERT INTO approved_vendor_locations
    (state, city, lga, zone_id, hub_id, default_courier_id,
     fez_hub_name, fez_hub_address,
     supports_vendor_direct_fez, supports_vendor_to_hub, supports_local_delivery,
     vendor_pickup_surcharge, status, notes)
VALUES
(
    'Rivers', 'Port Harcourt', 'Port Harcourt',
    (SELECT id FROM zones WHERE 'Rivers' = ANY(states) LIMIT 1),
    (SELECT id FROM hubs WHERE LOWER(city) LIKE '%port harcourt%' AND is_active = true LIMIT 1),
    (SELECT id FROM couriers WHERE code = 'fez' AND is_active = true LIMIT 1),
    'Fez Port Harcourt Hub', 'Fez Delivery PH Hub, Port Harcourt, Rivers State',
    true, true, false,
    500, 'active',
    'Vendor direct Fez pickup available.'
),
(
    'Rivers', 'Obio-Akpor', 'Obio-Akpor',
    (SELECT id FROM zones WHERE 'Rivers' = ANY(states) LIMIT 1),
    (SELECT id FROM hubs WHERE LOWER(city) LIKE '%port harcourt%' AND is_active = true LIMIT 1),
    (SELECT id FROM couriers WHERE code = 'fez' AND is_active = true LIMIT 1),
    'Fez Port Harcourt Hub', 'Fez Delivery PH Hub, Port Harcourt, Rivers State',
    true, true, false,
    500, 'active',
    'Served by Port Harcourt hub.'
)
ON CONFLICT (state, city, lga) DO NOTHING;
