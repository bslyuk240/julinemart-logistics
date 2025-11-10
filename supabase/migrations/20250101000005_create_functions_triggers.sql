- Function: Calculate shipping cost for an order
CREATE OR REPLACE FUNCTION calculate_shipping_cost(
    p_zone_id UUID,
    p_hub_id UUID,
    p_courier_id UUID,
    p_total_weight DECIMAL,
    p_order_value DECIMAL
)
RETURNS DECIMAL AS $$
DECLARE
    v_rate DECIMAL;
BEGIN
    -- Get the applicable rate
    SELECT 
        CASE 
            WHEN p_order_value >= COALESCE(free_shipping_threshold, 999999) THEN 0
            ELSE flat_rate + (COALESCE(per_kg_rate, 0) * p_total_weight)
        END INTO v_rate
    FROM shipping_rates
    WHERE zone_id = p_zone_id
        AND (courier_id = p_courier_id OR courier_id IS NULL)
        AND (hub_id = p_hub_id OR hub_id IS NULL)
        AND is_active = true
        AND (effective_from IS NULL OR effective_from <= CURRENT_DATE)
        AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
        AND (min_weight_kg IS NULL OR p_total_weight >= min_weight_kg)
        AND (max_weight_kg IS NULL OR p_total_weight <= max_weight_kg)
    ORDER BY priority DESC, flat_rate ASC
    LIMIT 1;
    
    RETURN COALESCE(v_rate, 0);
END;
$$ LANGUAGE plpgsql;

-- Function: Get zone by state
CREATE OR REPLACE FUNCTION get_zone_by_state(p_state VARCHAR)
RETURNS UUID AS $$
DECLARE
    v_zone_id UUID;
BEGIN
    SELECT id INTO v_zone_id
    FROM zones
    WHERE p_state = ANY(states)
    LIMIT 1;
    
    RETURN v_zone_id;
END;
$$ LANGUAGE plpgsql;

-- Function: Auto-assign courier to sub-order
CREATE OR REPLACE FUNCTION auto_assign_courier(p_sub_order_id UUID)
RETURNS UUID AS $$
DECLARE
    v_courier_id UUID;
    v_hub_id UUID;
    v_zone_id UUID;
BEGIN
    -- Get hub and zone from sub-order
    SELECT so.hub_id, o.delivery_zone::UUID INTO v_hub_id, v_zone_id
    FROM sub_orders so
    JOIN orders o ON so.main_order_id = o.id
    WHERE so.id = p_sub_order_id;
    
    -- Get the best courier for this hub-zone combo
    SELECT c.id INTO v_courier_id
    FROM couriers c
    JOIN hub_couriers hc ON c.id = hc.courier_id
    WHERE hc.hub_id = v_hub_id
        AND c.is_active = true
    ORDER BY hc.is_primary DESC, hc.priority DESC, c.success_rate DESC
    LIMIT 1;
    
    -- Update sub-order
    UPDATE sub_orders
    SET courier_id = v_courier_id
    WHERE id = p_sub_order_id;
    
    RETURN v_courier_id;
END;
$$ LANGUAGE plpgsql;

-- Function: Create tracking event
CREATE OR REPLACE FUNCTION create_tracking_event(
    p_sub_order_id UUID,
    p_status delivery_status,
    p_description TEXT,
    p_location_name VARCHAR DEFAULT NULL,
    p_actor_name VARCHAR DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_event_id UUID;
BEGIN
    INSERT INTO tracking_events (
        sub_order_id,
        status,
        description,
        location_name,
        actor_name,
        actor_type,
        source
    ) VALUES (
        p_sub_order_id,
        p_status,
        p_description,
        p_location_name,
        p_actor_name,
        'system',
        'api'
    ) RETURNING id INTO v_event_id;
    
    -- Update sub-order status
    UPDATE sub_orders
    SET status = p_status
    WHERE id = p_sub_order_id;
    
    RETURN v_event_id;
END;
$$ LANGUAGE plpgsql;

-- View: Order Summary
CREATE OR REPLACE VIEW order_summary AS
SELECT 
    o.id,
    o.woocommerce_order_id,
    o.customer_name,
    o.customer_email,
    o.delivery_city,
    o.delivery_state,
    o.total_amount,
    o.shipping_fee_paid,
    o.overall_status,
    o.payment_status,
    o.created_at,
    COUNT(DISTINCT so.id) as sub_order_count,
    COUNT(DISTINCT so.hub_id) as hub_count,
    SUM(so.real_shipping_cost) as total_real_shipping_cost,
    ARRAY_AGG(DISTINCT so.status) as sub_order_statuses
FROM orders o
LEFT JOIN sub_orders so ON o.id = so.main_order_id
GROUP BY o.id;

-- View: Hub Performance
CREATE OR REPLACE VIEW hub_performance AS
SELECT 
    h.id,
    h.name,
    h.city,
    h.state,
    COUNT(DISTINCT so.id) as total_orders,
    COUNT(DISTINCT CASE WHEN so.status = 'delivered' THEN so.id END) as delivered_orders,
    COUNT(DISTINCT CASE WHEN so.status = 'failed' THEN so.id END) as failed_orders,
    AVG(EXTRACT(EPOCH FROM (so.delivered_at - so.created_at))/86400) as avg_delivery_days,
    SUM(so.real_shipping_cost) as total_shipping_cost
FROM hubs h
LEFT JOIN sub_orders so ON h.id = so.hub_id
GROUP BY h.id;

-- View: Courier Performance
CREATE OR REPLACE VIEW courier_performance AS
SELECT 
    c.id,
    c.name,
    c.type,
    COUNT(DISTINCT so.id) as total_deliveries,
    COUNT(DISTINCT CASE WHEN so.status = 'delivered' THEN so.id END) as successful_deliveries,
    COUNT(DISTINCT CASE WHEN so.status = 'failed' THEN so.id END) as failed_deliveries,
    ROUND(
        COUNT(DISTINCT CASE WHEN so.status = 'delivered' THEN so.id END)::NUMERIC / 
        NULLIF(COUNT(DISTINCT so.id), 0) * 100, 
        2
    ) as success_rate_percent,
    AVG(EXTRACT(EPOCH FROM (so.delivered_at - so.picked_up_at))/86400) as avg_delivery_days,
    SUM(so.real_shipping_cost) as total_revenue
FROM couriers c
LEFT JOIN sub_orders so ON c.id = so.courier_id
GROUP BY c.id;

-- Create RLS policies (Row Level Security)
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE sub_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE hubs ENABLE ROW LEVEL SECURITY;
ALTER TABLE couriers ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;

-- Policy: Allow service role to do anything
CREATE POLICY "Service role has full access" ON orders
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role has full access" ON sub_orders
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);