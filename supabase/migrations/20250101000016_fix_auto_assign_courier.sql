-- Improve auto_assign_courier to use zone and silence lint warning
-- Chooses courier by active shipping_rates for the sub-order's hub+zone,
-- falling back to hub_couriers priority when no rate exists.

CREATE OR REPLACE FUNCTION auto_assign_courier(p_sub_order_id UUID)
RETURNS UUID AS $$
DECLARE
  v_courier_id UUID;
  v_hub_id UUID;
  v_zone_id UUID;
BEGIN
  -- Get hub and zone from sub-order/order
  SELECT so.hub_id, o.delivery_zone::UUID INTO v_hub_id, v_zone_id
  FROM sub_orders so
  JOIN orders o ON so.main_order_id = o.id
  WHERE so.id = p_sub_order_id;

  -- Prefer a courier that has an active shipping rate for this hub+zone
  SELECT sr.courier_id INTO v_courier_id
  FROM shipping_rates sr
  WHERE sr.hub_id = v_hub_id
    AND sr.zone_id = v_zone_id
    AND sr.is_active = true
  ORDER BY sr.priority DESC, sr.flat_rate ASC
  LIMIT 1;

  -- Fallback: use hub_couriers mapping and courier activity
  IF v_courier_id IS NULL THEN
    SELECT c.id INTO v_courier_id
    FROM couriers c
    JOIN hub_couriers hc ON c.id = hc.courier_id
    WHERE hc.hub_id = v_hub_id
      AND c.is_active = true
    ORDER BY hc.is_primary DESC, hc.priority DESC, c.success_rate DESC NULLS LAST
    LIMIT 1;
  END IF;

  -- Update the sub-order with the chosen courier
  UPDATE sub_orders
  SET courier_id = v_courier_id
  WHERE id = p_sub_order_id;

  RETURN v_courier_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION auto_assign_courier(UUID) IS 'Assigns best courier using hub+zone shipping rates, falling back to hub_couriers.';

