- Zones Table (Nigerian delivery zones)
CREATE TABLE zones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Zone Info
    name VARCHAR(100) NOT NULL UNIQUE,
    code VARCHAR(20) NOT NULL UNIQUE,
    description TEXT,
    
    -- Geographic Coverage
    states TEXT[] NOT NULL,
    cities JSONB DEFAULT '[]',
    
    -- Zone Classification
    zone_type VARCHAR(50), -- 'south-south', 'south-west', 'north-central', etc.
    is_remote BOOLEAN DEFAULT false,
    
    -- Delivery Estimates
    estimated_delivery_days INTEGER,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Shipping Rates Table
CREATE TABLE shipping_rates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Rate Configuration
    zone_id UUID REFERENCES zones(id) ON DELETE CASCADE,
    courier_id UUID REFERENCES couriers(id),
    hub_id UUID REFERENCES hubs(id),
    
    -- Rate Details
    flat_rate DECIMAL(10,2) NOT NULL,
    per_kg_rate DECIMAL(10,2),
    
    -- Weight Brackets
    min_weight_kg DECIMAL(8,2) DEFAULT 0,
    max_weight_kg DECIMAL(8,2),
    
    -- Price Brackets
    min_order_value DECIMAL(10,2),
    max_order_value DECIMAL(10,2),
    
    -- Free Shipping Threshold
    free_shipping_threshold DECIMAL(10,2),
    
    -- Settings
    is_active BOOLEAN DEFAULT true,
    priority INTEGER DEFAULT 0,
    
    -- Effective Dates
    effective_from DATE,
    effective_to DATE,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    -- Ensure no overlapping rates for same zone/courier/hub combo
    UNIQUE NULLS NOT DISTINCT (zone_id, courier_id, hub_id, effective_from)
);

-- Rate History (for analytics)
CREATE TABLE rate_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    zone_id UUID REFERENCES zones(id),
    courier_id UUID REFERENCES couriers(id),
    
    old_rate DECIMAL(10,2),
    new_rate DECIMAL(10,2),
    
    change_reason TEXT,
    changed_by VARCHAR(255),
    
    created_at TIMESTAMP DEFAULT NOW()
);

-- Create Indexes
CREATE INDEX idx_zones_code ON zones(code);
CREATE INDEX idx_zones_states ON zones USING GIN(states);

CREATE INDEX idx_shipping_rates_zone ON shipping_rates(zone_id);
CREATE INDEX idx_shipping_rates_courier ON shipping_rates(courier_id);
CREATE INDEX idx_shipping_rates_hub ON shipping_rates(hub_id);
CREATE INDEX idx_shipping_rates_active ON shipping_rates(is_active);
CREATE INDEX idx_shipping_rates_effective ON shipping_rates(effective_from, effective_to);

CREATE INDEX idx_rate_history_zone ON rate_history(zone_id);
CREATE INDEX idx_rate_history_created ON rate_history(created_at DESC);

-- Create Triggers
CREATE TRIGGER update_zones_updated_at
    BEFORE UPDATE ON zones
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_shipping_rates_updated_at
    BEFORE UPDATE ON shipping_rates
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Trigger to log rate changes
CREATE OR REPLACE FUNCTION log_rate_change()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.flat_rate != NEW.flat_rate THEN
        INSERT INTO rate_history (zone_id, courier_id, old_rate, new_rate, change_reason)
        VALUES (NEW.zone_id, NEW.courier_id, OLD.flat_rate, NEW.flat_rate, 'Rate updated');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER track_rate_changes
    AFTER UPDATE ON shipping_rates
    FOR EACH ROW
    EXECUTE FUNCTION log_rate_change();