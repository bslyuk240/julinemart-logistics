- Tracking Events Table
CREATE TABLE tracking_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sub_order_id UUID REFERENCES sub_orders(id) ON DELETE CASCADE,
    status delivery_status NOT NULL,
    event_time TIMESTAMP NOT NULL DEFAULT NOW(),
    location_name VARCHAR(255),
    location_city VARCHAR(100),
    location_state VARCHAR(100),
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    description TEXT,
    remarks TEXT,
    actor_type VARCHAR(50), -- 'system', 'courier', 'hub', 'vendor', 'customer'
    actor_name VARCHAR(255),
    source VARCHAR(50), -- 'webhook', 'manual', 'api', 'scan'
    source_reference VARCHAR(255),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW()
);

-- Delivery Attempts Table
CREATE TABLE delivery_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sub_order_id UUID REFERENCES sub_orders(id) ON DELETE CASCADE,
    attempt_number INTEGER NOT NULL,
    attempted_at TIMESTAMP NOT NULL,
    status VARCHAR(50) NOT NULL, -- 'failed', 'rescheduled', 'successful'
    failure_reason TEXT,
    rescheduled_for TIMESTAMP,
    contacted_customer BOOLEAN DEFAULT false,
    customer_response TEXT,
    rider_name VARCHAR(255),
    rider_phone VARCHAR(20),
    attempted_location TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW()
);

-- Customer Feedback Table
CREATE TABLE customer_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
    sub_order_id UUID REFERENCES sub_orders(id) ON DELETE CASCADE,
    delivery_rating INTEGER CHECK (delivery_rating BETWEEN 1 AND 5),
    courier_rating INTEGER CHECK (courier_rating BETWEEN 1 AND 5),
    feedback_text TEXT,
    has_issue BOOLEAN DEFAULT false,
    issue_type VARCHAR(50), -- 'damaged', 'late', 'missing', 'wrong_item', 'other'
    issue_description TEXT,
    issue_resolved BOOLEAN DEFAULT false,
    resolution_notes TEXT,
    resolved_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_tracking_events_sub_order ON tracking_events(sub_order_id);
CREATE INDEX idx_tracking_events_status ON tracking_events(status);
CREATE INDEX idx_tracking_events_time ON tracking_events(event_time DESC);

CREATE INDEX idx_delivery_attempts_sub_order ON delivery_attempts(sub_order_id);
CREATE INDEX idx_delivery_attempts_status ON delivery_attempts(status);
CREATE INDEX idx_delivery_attempts_time ON delivery_attempts(attempted_at DESC);

CREATE INDEX idx_customer_feedback_order ON customer_feedback(order_id);
CREATE INDEX idx_customer_feedback_sub_order ON customer_feedback(sub_order_id);
CREATE INDEX idx_customer_feedback_has_issue ON customer_feedback(has_issue);

-- Auto-update vendor metrics
CREATE OR REPLACE FUNCTION update_vendor_metrics()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.status != NEW.status) THEN
        UPDATE vendors
        SET 
            total_orders = (
                SELECT COUNT(*) 
                FROM sub_orders 
                WHERE vendor_id = NEW.vendor_id
            ),
            fulfilled_orders = (
                SELECT COUNT(*) 
                FROM sub_orders 
                WHERE vendor_id = NEW.vendor_id 
                AND status = 'delivered'
            )
        WHERE id = NEW.vendor_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER track_vendor_metrics
    AFTER INSERT OR UPDATE ON sub_orders
    FOR EACH ROW
    EXECUTE FUNCTION update_vendor_metrics();
