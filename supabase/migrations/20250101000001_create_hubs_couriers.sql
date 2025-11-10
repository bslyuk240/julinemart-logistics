- Couriers Table (create first since hubs references it)
CREATE TABLE couriers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) UNIQUE NOT NULL,
    type courier_type NOT NULL,
    api_url TEXT,
    api_key_encrypted TEXT,
    api_username TEXT,
    webhook_url TEXT,
    is_active BOOLEAN DEFAULT true,
    supports_tracking BOOLEAN DEFAULT true,
    supports_cod BOOLEAN DEFAULT false,
    base_rate DECIMAL(10,2),
    rate_per_kg DECIMAL(10,2),
    service_zones TEXT[] DEFAULT '{}',
    excluded_zones TEXT[] DEFAULT '{}',
    average_delivery_time_days DECIMAL(4,2),
    success_rate DECIMAL(5,2),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Hubs Table
CREATE TABLE hubs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) UNIQUE NOT NULL,
    address TEXT NOT NULL,
    city VARCHAR(100) NOT NULL,
    state VARCHAR(100) NOT NULL,
    lga VARCHAR(100),
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    phone VARCHAR(20),
    email VARCHAR(255),
    manager_name VARCHAR(255),
    manager_phone VARCHAR(20),
    is_active BOOLEAN DEFAULT true,
    can_ship_nationwide BOOLEAN DEFAULT true,
    preferred_courier_id UUID REFERENCES couriers(id),
    operating_hours JSONB DEFAULT '{}',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Vendors Table
CREATE TABLE vendors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    woocommerce_vendor_id VARCHAR(50) UNIQUE NOT NULL,
    store_name VARCHAR(255) NOT NULL,
    store_slug VARCHAR(255) UNIQUE,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(20),
    hub_id UUID REFERENCES hubs(id),
    address TEXT,
    city VARCHAR(100),
    state VARCHAR(100),
    business_name VARCHAR(255),
    tax_id VARCHAR(100),
    is_active BOOLEAN DEFAULT true,
    can_ship_nationwide BOOLEAN DEFAULT true,
    auto_process_orders BOOLEAN DEFAULT true,
    commission_rate DECIMAL(5,2) DEFAULT 0,
    shipping_cost_responsibility VARCHAR(20) DEFAULT 'shared',
    total_orders INTEGER DEFAULT 0,
    fulfilled_orders INTEGER DEFAULT 0,
    average_processing_time_hours DECIMAL(6,2),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Hub-Courier Relationship
CREATE TABLE hub_couriers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hub_id UUID REFERENCES hubs(id) ON DELETE CASCADE,
    courier_id UUID REFERENCES couriers(id) ON DELETE CASCADE,
    is_primary BOOLEAN DEFAULT false,
    priority INTEGER DEFAULT 0,
    custom_base_rate DECIMAL(10,2),
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(hub_id, courier_id)
);

-- Indexes
CREATE INDEX idx_hubs_code ON hubs(code);
CREATE INDEX idx_hubs_state ON hubs(state);
CREATE INDEX idx_couriers_code ON couriers(code);
CREATE INDEX idx_couriers_type ON couriers(type);
CREATE INDEX idx_vendors_wc_id ON vendors(woocommerce_vendor_id);
CREATE INDEX idx_vendors_hub ON vendors(hub_id);

-- Triggers
CREATE TRIGGER update_hubs_updated_at BEFORE UPDATE ON hubs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_couriers_updated_at BEFORE UPDATE ON couriers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_vendors_updated_at BEFORE UPDATE ON vendors
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();