-- Seed Data for JulineMart Logistics Orchestrator

-- Insert Nigerian Zones
INSERT INTO zones (name, code, states, zone_type, estimated_delivery_days) VALUES
('South South', 'SS', ARRAY['Delta', 'Edo', 'Bayelsa', 'Rivers', 'Cross River', 'Akwa Ibom'], 'south-south', 2),
('South West', 'SW', ARRAY['Lagos', 'Ogun', 'Oyo', 'Osun', 'Ondo', 'Ekiti'], 'south-west', 2),
('South East', 'SE', ARRAY['Abia', 'Anambra', 'Ebonyi', 'Enugu', 'Imo'], 'south-east', 3),
('North Central', 'NC', ARRAY['Abuja', 'FCT', 'Niger', 'Kogi', 'Benue', 'Plateau', 'Nassarawa', 'Kwara'], 'north-central', 4),
('North West', 'NW', ARRAY['Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Sokoto', 'Zamfara', 'Jigawa'], 'north-west', 5),
('North East', 'NE', ARRAY['Adamawa', 'Bauchi', 'Borno', 'Gombe', 'Taraba', 'Yobe'], 'north-east', 5);

-- Insert Primary Couriers
INSERT INTO couriers (name, code, type, is_active, supports_tracking, base_rate, average_delivery_time_days) VALUES
('Fez Delivery', 'FEZ', 'fez', true, true, 2500.00, 2.5),
('GIGL', 'GIGL', 'gigl', true, true, 3000.00, 3.0),
('Kwik Delivery', 'KWIK', 'kwik', true, true, 2800.00, 1.5),
('GIG Logistics', 'GIG', 'other', true, true, 2700.00, 3.0);

-- Insert Initial Hubs
INSERT INTO hubs (name, code, address, city, state, phone, manager_name, is_active) VALUES
('Warri Hub', 'WAR-HUB-01', '123 Main Street, Warri', 'Warri', 'Delta', '08012345678', 'Hub Manager', true),
('Lagos Hub', 'LAG-HUB-01', '456 Lagos Road, Ikeja', 'Lagos', 'Lagos', '08087654321', 'Lagos Manager', true),
('Abuja Hub', 'ABJ-HUB-01', '789 Federal Capital Territory', 'Abuja', 'Abuja', '08098765432', 'Abuja Manager', true);

-- Link Hubs to Couriers
INSERT INTO hub_couriers (hub_id, courier_id, is_primary, priority) VALUES
((SELECT id FROM hubs WHERE code = 'WAR-HUB-01'), (SELECT id FROM couriers WHERE code = 'FEZ'), true, 1),
((SELECT id FROM hubs WHERE code = 'WAR-HUB-01'), (SELECT id FROM couriers WHERE code = 'GIGL'), false, 2),
((SELECT id FROM hubs WHERE code = 'LAG-HUB-01'), (SELECT id FROM couriers WHERE code = 'FEZ'), true, 1),
((SELECT id FROM hubs WHERE code = 'ABJ-HUB-01'), (SELECT id FROM couriers WHERE code = 'GIGL'), true, 1);

-- Insert Shipping Rates (Dynamic Flat Rates)
INSERT INTO shipping_rates (zone_id, flat_rate, is_active, effective_from) VALUES
((SELECT id FROM zones WHERE code = 'SS'), 2800.00, true, CURRENT_DATE),
((SELECT id FROM zones WHERE code = 'SW'), 3500.00, true, CURRENT_DATE),
((SELECT id FROM zones WHERE code = 'SE'), 3800.00, true, CURRENT_DATE),
((SELECT id FROM zones WHERE code = 'NC'), 4000.00, true, CURRENT_DATE),
((SELECT id FROM zones WHERE code = 'NW'), 4500.00, true, CURRENT_DATE),
((SELECT id FROM zones WHERE code = 'NE'), 4500.00, true, CURRENT_DATE);