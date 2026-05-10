-- ============================================================
-- Approved Vendor Locations
-- Controls which cities/LGAs vendors can register from.
-- The selected location gates registration and auto-assigns
-- fulfilment mode, hub, and courier at onboarding.
-- ============================================================

-- Status enum for approved locations
CREATE TYPE vendor_location_status AS ENUM (
    'active',          -- open for new vendor registrations
    'paused',          -- existing vendors operate, no new onboarding
    'waitlist_only',   -- show waitlist form, no registration
    'coming_soon'      -- visible to admin only, not shown on form
);

-- Fez collection method enum (vendor preference)
CREATE TYPE fez_collection_method AS ENUM (
    'fez_pickup',   -- Fez rider comes to vendor's shop
    'hub_dropoff'   -- Vendor drops parcel at nearest Fez hub
);

-- ============================================================
-- approved_vendor_locations
-- Each row is one LGA/area JulineMart actively supports.
-- ============================================================
CREATE TABLE approved_vendor_locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Geography (granular: state → city → LGA)
    country         VARCHAR(100) NOT NULL DEFAULT 'Nigeria',
    state           VARCHAR(100) NOT NULL,
    city            VARCHAR(100) NOT NULL,
    lga             VARCHAR(100) NOT NULL,

    -- Links to existing system tables
    zone_id         UUID REFERENCES zones(id),      -- for shipping rate lookup
    hub_id          UUID REFERENCES hubs(id),        -- JulineMart hub serving this area
    default_courier_id UUID REFERENCES couriers(id), -- courier assigned to this location

    -- Fez drop-off hub info (Fez's own collection point, not JulineMart hub)
    fez_hub_name    VARCHAR(255),
    fez_hub_address TEXT,

    -- Supported fulfilment modes
    supports_vendor_direct_fez  BOOLEAN NOT NULL DEFAULT true,
    supports_vendor_to_hub      BOOLEAN NOT NULL DEFAULT false,
    supports_local_delivery     BOOLEAN NOT NULL DEFAULT false,

    -- Additional fee when Fez rides to vendor's door for pickup
    -- Who pays is determined by vendor.shipping_cost_responsibility
    vendor_pickup_surcharge     DECIMAL(10,2) DEFAULT 0,

    -- Operational status
    status          vendor_location_status NOT NULL DEFAULT 'active',

    -- Metadata
    notes           TEXT,
    metadata        JSONB DEFAULT '{}',

    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW(),

    -- One row per LGA (prevent duplicate city/LGA entries)
    UNIQUE (state, city, lga)
);

CREATE INDEX idx_avl_state ON approved_vendor_locations(state);
CREATE INDEX idx_avl_status ON approved_vendor_locations(status);
CREATE INDEX idx_avl_zone ON approved_vendor_locations(zone_id);
CREATE INDEX idx_avl_hub ON approved_vendor_locations(hub_id);

CREATE TRIGGER update_avl_updated_at
    BEFORE UPDATE ON approved_vendor_locations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- vendor_location_waitlist
-- Captures demand from vendors in cities not yet approved.
-- Used to prioritise expansion decisions.
-- ============================================================
CREATE TABLE vendor_location_waitlist (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    full_name           VARCHAR(255) NOT NULL,
    email               VARCHAR(255) NOT NULL,
    phone               VARCHAR(20),

    -- Where they are
    state               VARCHAR(100) NOT NULL,
    city                VARCHAR(100) NOT NULL,
    lga                 VARCHAR(100),

    -- Demand signals (for expansion prioritisation)
    vendor_category     VARCHAR(100),  -- fashion, electronics, food, etc.
    est_monthly_orders  INTEGER,       -- self-reported volume estimate

    -- Activation tracking
    notified_at         TIMESTAMP,     -- set when city goes live and email sent
    converted_to_vendor BOOLEAN DEFAULT false, -- set when they complete registration

    created_at          TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_waitlist_email ON vendor_location_waitlist(email);
CREATE INDEX idx_waitlist_state_city ON vendor_location_waitlist(state, city);
CREATE INDEX idx_waitlist_notified ON vendor_location_waitlist(notified_at);

-- ============================================================
-- Alter vendor_applications — add location fields
-- ============================================================
ALTER TABLE vendor_applications
    ADD COLUMN IF NOT EXISTS lga                    TEXT,
    ADD COLUMN IF NOT EXISTS fez_collection_method  fez_collection_method,
    ADD COLUMN IF NOT EXISTS approved_location_id   UUID REFERENCES approved_vendor_locations(id);

-- ============================================================
-- Alter vendors — add location + collection fields
-- ============================================================
ALTER TABLE vendors
    ADD COLUMN IF NOT EXISTS lga                    TEXT,
    ADD COLUMN IF NOT EXISTS fez_collection_method  fez_collection_method DEFAULT 'hub_dropoff',
    ADD COLUMN IF NOT EXISTS approved_location_id   UUID REFERENCES approved_vendor_locations(id);

-- ============================================================
-- shipping_settings
-- Configurable multi-dispatch shipping discount parameters.
-- One row, managed from admin settings page.
-- ============================================================
CREATE TABLE shipping_settings (
    id                              INTEGER PRIMARY KEY DEFAULT 1,
    -- Discount applied to the summed total when cart has
    -- items from 2+ distinct dispatch locations
    multi_dispatch_discount_pct     DECIMAL(5,2) DEFAULT 0,
    -- Hard cap on the discount amount in Naira (0 = no cap)
    multi_dispatch_discount_cap     DECIMAL(10,2) DEFAULT 0,
    -- Whether discount is active at all
    multi_dispatch_discount_active  BOOLEAN DEFAULT false,

    updated_at                      TIMESTAMP DEFAULT NOW(),
    updated_by                      TEXT,

    -- Enforce single-row table
    CONSTRAINT single_row CHECK (id = 1)
);

-- Insert default row
INSERT INTO shipping_settings (id) VALUES (1)
    ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- RLS Policies
-- ============================================================

ALTER TABLE approved_vendor_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_location_waitlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipping_settings ENABLE ROW LEVEL SECURITY;

-- Public can read active approved locations (needed by registration form)
CREATE POLICY "Public read active vendor locations"
    ON approved_vendor_locations FOR SELECT
    USING (status = 'active');

-- Admins can do everything on approved_vendor_locations
CREATE POLICY "Admin full access vendor locations"
    ON approved_vendor_locations FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE users.id = auth.uid()
            AND users.role IN ('admin', 'manager')
        )
    );

-- Anyone can insert to waitlist (public signup)
CREATE POLICY "Public insert waitlist"
    ON vendor_location_waitlist FOR INSERT
    WITH CHECK (true);

-- Only admins can read/manage waitlist
CREATE POLICY "Admin manage waitlist"
    ON vendor_location_waitlist FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE users.id = auth.uid()
            AND users.role IN ('admin', 'manager')
        )
    );

-- Public can read shipping settings (needed by calc-shipping)
CREATE POLICY "Public read shipping settings"
    ON shipping_settings FOR SELECT
    USING (true);

-- Only admins can update shipping settings
CREATE POLICY "Admin update shipping settings"
    ON shipping_settings FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE users.id = auth.uid()
            AND users.role IN ('admin', 'manager')
        )
    );
