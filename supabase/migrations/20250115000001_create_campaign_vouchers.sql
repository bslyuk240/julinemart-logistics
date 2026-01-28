-- Campaign Vouchers Table
-- For promotional campaigns where customers get free/discounted products
-- Vendors still get paid full price - JulineMart absorbs the cost

CREATE TABLE campaign_vouchers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Voucher code (case-insensitive unique)
    code VARCHAR(50) UNIQUE NOT NULL,
    
    -- Campaign information
    campaign_name VARCHAR(255) NOT NULL,
    description TEXT,
    
    -- Discount type and value
    discount_type VARCHAR(20) NOT NULL DEFAULT 'free', -- 'free', 'percentage', 'fixed_amount'
    discount_value DECIMAL(10,2), -- percentage (0-100) or fixed amount
    
    -- Product/Vendor restrictions (NULL = any product/vendor)
    product_ids TEXT[], -- Array of WooCommerce product IDs
    vendor_ids UUID[], -- Array of vendor UUIDs
    
    -- Usage controls
    max_uses INTEGER DEFAULT 1, -- Total redemptions allowed
    current_uses INTEGER DEFAULT 0, -- Current redemption count
    max_uses_per_customer INTEGER DEFAULT 1, -- Per email address
    
    -- Validity period
    valid_from TIMESTAMP DEFAULT NOW(),
    valid_until TIMESTAMP,
    
    -- Status
    status VARCHAR(20) DEFAULT 'active', -- 'active', 'used', 'expired', 'cancelled'
    
    -- Financial tracking
    total_cost_absorbed DECIMAL(12,2) DEFAULT 0, -- Total amount JulineMart paid
    total_vendor_payout DECIMAL(12,2) DEFAULT 0, -- Total paid to vendors
    
    -- Admin tracking
    created_by VARCHAR(255),
    notes TEXT,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Voucher Redemptions Tracking Table
CREATE TABLE voucher_redemptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Links
    voucher_id UUID NOT NULL REFERENCES campaign_vouchers(id) ON DELETE CASCADE,
    order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    sub_order_id UUID REFERENCES sub_orders(id) ON DELETE SET NULL,
    woocommerce_order_id VARCHAR(50),
    
    -- Customer information
    customer_email VARCHAR(255) NOT NULL,
    customer_name VARCHAR(255),
    
    -- Redemption details
    product_id VARCHAR(50), -- WooCommerce product ID
    vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL,
    
    -- Financial breakdown
    original_price DECIMAL(10,2) NOT NULL, -- Full product price
    discount_applied DECIMAL(10,2) NOT NULL, -- Discount given to customer
    customer_paid DECIMAL(10,2) NOT NULL, -- What customer actually paid
    vendor_payout DECIMAL(10,2) NOT NULL, -- What vendor receives (full price - commission)
    julinemart_absorbed DECIMAL(10,2) NOT NULL, -- Cost absorbed by JulineMart
    
    -- Metadata
    order_metadata JSONB DEFAULT '{}',
    
    -- Timestamps
    redeemed_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_campaign_vouchers_code ON campaign_vouchers(UPPER(code));
CREATE INDEX idx_campaign_vouchers_status ON campaign_vouchers(status);
CREATE INDEX idx_campaign_vouchers_campaign ON campaign_vouchers(campaign_name);
CREATE INDEX idx_campaign_vouchers_valid ON campaign_vouchers(valid_from, valid_until);

CREATE INDEX idx_voucher_redemptions_voucher ON voucher_redemptions(voucher_id);
CREATE INDEX idx_voucher_redemptions_order ON voucher_redemptions(order_id);
CREATE INDEX idx_voucher_redemptions_customer ON voucher_redemptions(customer_email);
CREATE INDEX idx_voucher_redemptions_redeemed ON voucher_redemptions(redeemed_at);

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION update_voucher_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_campaign_vouchers_timestamp
    BEFORE UPDATE ON campaign_vouchers
    FOR EACH ROW
    EXECUTE FUNCTION update_voucher_timestamp();

-- Auto-update status based on usage
CREATE OR REPLACE FUNCTION check_voucher_status()
RETURNS TRIGGER AS $$
BEGIN
    -- Mark as 'used' if max uses reached
    IF NEW.current_uses >= NEW.max_uses THEN
        NEW.status = 'used';
    END IF;
    
    -- Mark as 'expired' if past valid_until date
    IF NEW.valid_until IS NOT NULL AND NEW.valid_until < NOW() THEN
        NEW.status = 'expired';
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER check_voucher_status_on_update
    BEFORE UPDATE ON campaign_vouchers
    FOR EACH ROW
    EXECUTE FUNCTION check_voucher_status();

-- RLS Policies (optional - adjust based on your security needs)
ALTER TABLE campaign_vouchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE voucher_redemptions ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY service_role_all_campaign_vouchers ON campaign_vouchers
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY service_role_all_voucher_redemptions ON voucher_redemptions
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Admin users can manage vouchers (adjust based on your auth setup)
CREATE POLICY admin_manage_vouchers ON campaign_vouchers
    FOR ALL
    TO authenticated
    USING (true) -- Add your admin check here: auth.jwt()->>'role' = 'admin'
    WITH CHECK (true);

-- All authenticated users can view redemptions (for reporting)
CREATE POLICY authenticated_view_redemptions ON voucher_redemptions
    FOR SELECT
    TO authenticated
    USING (true);

COMMENT ON TABLE campaign_vouchers IS 'Promotional voucher codes for campaigns where JulineMart absorbs the discount cost while vendors receive full payment';
COMMENT ON TABLE voucher_redemptions IS 'Tracks each voucher redemption with financial breakdown showing customer discount and vendor payout';
