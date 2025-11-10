-- =====================================================
-- Courier Settlement & Payout System
-- =====================================================

-- Add settlement tracking columns to sub_orders
ALTER TABLE sub_orders
ADD COLUMN IF NOT EXISTS courier_charge numeric(10,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS courier_paid_amount numeric(10,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS settlement_status text DEFAULT 'pending' CHECK (settlement_status IN ('pending', 'approved', 'paid', 'disputed')),
ADD COLUMN IF NOT EXISTS settlement_date timestamp with time zone,
ADD COLUMN IF NOT EXISTS payment_reference text;

-- Create courier_settlements table (batch payments)
CREATE TABLE IF NOT EXISTS courier_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  courier_id uuid REFERENCES couriers(id) ON DELETE RESTRICT,
  settlement_period_start date NOT NULL,
  settlement_period_end date NOT NULL,
  total_shipments integer DEFAULT 0,
  total_amount_due numeric(10,2) DEFAULT 0,
  total_amount_paid numeric(10,2) DEFAULT 0,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'processing', 'paid', 'partial')),
  payment_method text,
  payment_reference text,
  payment_date timestamp with time zone,
  notes text,
  approved_by uuid REFERENCES users(id),
  approved_at timestamp with time zone,
  paid_by uuid REFERENCES users(id),
  paid_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Link sub_orders to settlements
CREATE TABLE IF NOT EXISTS settlement_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id uuid REFERENCES courier_settlements(id) ON DELETE CASCADE,
  sub_order_id uuid REFERENCES sub_orders(id) ON DELETE CASCADE,
  amount numeric(10,2) NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  UNIQUE(settlement_id, sub_order_id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_sub_orders_settlement ON sub_orders(courier_id, settlement_status, created_at);
CREATE INDEX IF NOT EXISTS idx_courier_settlements_courier ON courier_settlements(courier_id, status);
CREATE INDEX IF NOT EXISTS idx_courier_settlements_period ON courier_settlements(settlement_period_start, settlement_period_end);
CREATE INDEX IF NOT EXISTS idx_settlement_items_settlement ON settlement_items(settlement_id);

-- Create view for pending settlements
CREATE OR REPLACE VIEW pending_courier_payments AS
SELECT
  c.id AS courier_id,
  c.name AS courier_name,
  c.code AS courier_code,
  COUNT(so.id) AS pending_shipments,
  SUM(so.real_shipping_cost) AS total_amount_due,
  MAX(so.created_at) AS last_shipment_date
FROM couriers c
JOIN sub_orders so ON so.courier_id = c.id
WHERE so.status = 'delivered'
  AND (so.allocated_shipping_fee IS NULL OR so.allocated_shipping_fee = 0)
GROUP BY c.id, c.name, c.code;


-- Create view for settlement history
CREATE OR REPLACE VIEW courier_settlement_summary AS
SELECT 
  cs.id,
  cs.courier_id,
  c.name as courier_name,
  cs.settlement_period_start,
  cs.settlement_period_end,
  cs.total_shipments,
  cs.total_amount_due,
  cs.total_amount_paid,
  cs.status,
  cs.payment_date,
  cs.payment_reference,
  u.full_name as paid_by_name,
  cs.created_at
FROM courier_settlements cs
LEFT JOIN couriers c ON c.id = cs.courier_id
LEFT JOIN users u ON u.id = cs.paid_by
ORDER BY cs.created_at DESC;

-- Trigger to update settlement when sub_order is marked as delivered
CREATE OR REPLACE FUNCTION calculate_courier_charge()
RETURNS TRIGGER AS $$
BEGIN
  -- When shipment is delivered, set courier charge (what we owe them)
  IF NEW.status = 'delivered' AND OLD.status != 'delivered' THEN
    NEW.courier_charge = NEW.SUM(so.real_shipping_cost);
    NEW.settlement_status = 'pending';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_calculate_courier_charge ON sub_orders;
CREATE TRIGGER trigger_calculate_courier_charge
  BEFORE UPDATE ON sub_orders
  FOR EACH ROW
  EXECUTE FUNCTION calculate_courier_charge();

-- Function to create settlement batch
CREATE OR REPLACE FUNCTION create_courier_settlement(
  p_courier_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS uuid AS $$
DECLARE
  v_settlement_id uuid;
  v_total_shipments integer;
  v_total_amount numeric;
BEGIN
  -- Count pending shipments
  SELECT COUNT(*), COALESCE(SUM(shipping_cost), 0)
  INTO v_total_shipments, v_total_amount
  FROM sub_orders
  WHERE courier_id = p_courier_id
    AND settlement_status = 'pending'
    AND status = 'delivered'
    AND created_at::date BETWEEN p_start_date AND p_end_date;

  -- Create settlement
  INSERT INTO courier_settlements (
    courier_id,
    settlement_period_start,
    settlement_period_end,
    total_shipments,
    total_amount_due,
    status
  ) VALUES (
    p_courier_id,
    p_start_date,
    p_end_date,
    v_total_shipments,
    v_total_amount,
    'pending'
  ) RETURNING id INTO v_settlement_id;

  -- Link sub_orders to settlement
  INSERT INTO settlement_items (settlement_id, sub_order_id, amount)
  SELECT v_settlement_id, id, shipping_cost
  FROM sub_orders
  WHERE courier_id = p_courier_id
    AND settlement_status = 'pending'
    AND status = 'delivered'
    AND created_at::date BETWEEN p_start_date AND p_end_date;

  -- Update sub_orders settlement status
  UPDATE sub_orders
  SET settlement_status = 'approved'
  WHERE courier_id = p_courier_id
    AND settlement_status = 'pending'
    AND status = 'delivered'
    AND created_at::date BETWEEN p_start_date AND p_end_date;

  RETURN v_settlement_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE courier_settlements IS 'Batch payments to courier partners';
COMMENT ON COLUMN sub_orders.courier_charge IS 'Amount we owe the courier for this shipment';
COMMENT ON COLUMN sub_orders.courier_paid_amount IS 'Amount actually paid to courier';
COMMENT ON COLUMN sub_orders.settlement_status IS 'Payment status: pending, approved, paid, disputed';

SELECT 'Courier settlement system created successfully!' as status;
