- Main Orders Table
CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    woocommerce_order_id VARCHAR(50) UNIQUE NOT NULL,
    
    -- Customer Information
    customer_name VARCHAR(255) NOT NULL,
    customer_email VARCHAR(255) NOT NULL,
    customer_phone VARCHAR(20) NOT NULL,
    
    -- Delivery Information
    delivery_address TEXT NOT NULL,
    delivery_city VARCHAR(100) NOT NULL,
    delivery_state VARCHAR(100) NOT NULL,
    delivery_zone VARCHAR(50) NOT NULL,
    delivery_lga VARCHAR(100),
    delivery_landmark TEXT,
    
    -- Order Amounts
    subtotal DECIMAL(12,2) NOT NULL,
    total_amount DECIMAL(12,2) NOT NULL,
    shipping_fee_paid DECIMAL(10,2) NOT NULL,
    tax_amount DECIMAL(10,2) DEFAULT 0,
    discount_amount DECIMAL(10,2) DEFAULT 0,
    
    -- Status
    payment_status payment_status DEFAULT 'pending',
    overall_status order_status DEFAULT 'pending',
    
    -- Payment Info
    payment_method VARCHAR(50),
    payment_reference VARCHAR(100),
    paid_at TIMESTAMP,
    
    -- Metadata
    order_notes TEXT,
    special_instructions TEXT,
    metadata JSONB DEFAULT '{}',
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Sub Orders Table (per hub/vendor)
CREATE TABLE sub_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    main_order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
    
    -- Hub & Vendor
    hub_id UUID REFERENCES hubs(id),
    vendor_id UUID REFERENCES vendors(id),
    
    -- Courier Assignment
    courier_id UUID REFERENCES couriers(id),
    tracking_number VARCHAR(100),
    courier_waybill VARCHAR(100),
    
    -- Items in this sub-order
    items JSONB NOT NULL,
    
    -- Costs
    subtotal DECIMAL(10,2) NOT NULL,
    real_shipping_cost DECIMAL(10,2),
    allocated_shipping_fee DECIMAL(10,2),
    
    -- Status
    status delivery_status DEFAULT 'pending',
    
    -- Delivery Tracking
    pickup_scheduled_at TIMESTAMP,
    picked_up_at TIMESTAMP,
    in_transit_at TIMESTAMP,
    out_for_delivery_at TIMESTAMP,
    delivered_at TIMESTAMP,
    failed_at TIMESTAMP,
    
    -- Delivery Person Info
    rider_name VARCHAR(255),
    rider_phone VARCHAR(20),
    
    -- Notes
    hub_notes TEXT,
    courier_notes TEXT,
    delivery_proof_url TEXT,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Order Items (detailed breakdown)
CREATE TABLE order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
    sub_order_id UUID REFERENCES sub_orders(id) ON DELETE CASCADE,
    
    -- Product Info
    product_id VARCHAR(50) NOT NULL,
    product_name VARCHAR(255) NOT NULL,
    product_sku VARCHAR(100),
    variation_id VARCHAR(50),
    variation_details JSONB,
    
    -- Vendor & Hub
    vendor_id UUID REFERENCES vendors(id),
    hub_id UUID REFERENCES hubs(id),
    
    -- Pricing
    unit_price DECIMAL(10,2) NOT NULL,
    quantity INTEGER NOT NULL,
    subtotal DECIMAL(10,2) NOT NULL,
    tax DECIMAL(10,2) DEFAULT 0,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    
    created_at TIMESTAMP DEFAULT NOW()
);

-- Create Indexes
CREATE INDEX idx_orders_wc_id ON orders(woocommerce_order_id);
CREATE INDEX idx_orders_customer_email ON orders(customer_email);
CREATE INDEX idx_orders_status ON orders(overall_status);
CREATE INDEX idx_orders_payment_status ON orders(payment_status);
CREATE INDEX idx_orders_zone ON orders(delivery_zone);
CREATE INDEX idx_orders_created_at ON orders(created_at DESC);

CREATE INDEX idx_sub_orders_main ON sub_orders(main_order_id);
CREATE INDEX idx_sub_orders_hub ON sub_orders(hub_id);
CREATE INDEX idx_sub_orders_vendor ON sub_orders(vendor_id);
CREATE INDEX idx_sub_orders_courier ON sub_orders(courier_id);
CREATE INDEX idx_sub_orders_tracking ON sub_orders(tracking_number);
CREATE INDEX idx_sub_orders_status ON sub_orders(status);

CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_order_items_sub_order ON order_items(sub_order_id);
CREATE INDEX idx_order_items_product ON order_items(product_id);

-- Create Triggers
CREATE TRIGGER update_orders_updated_at
    BEFORE UPDATE ON orders
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_sub_orders_updated_at
    BEFORE UPDATE ON sub_orders
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();