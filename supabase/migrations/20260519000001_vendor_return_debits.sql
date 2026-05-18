-- vendor_return_debits: tracks earnings owed back to JulineMart when a vendor has
-- already withdrawn their payout for an order that is later returned and refunded.

-- 1. Add vendor_approved to return_shipments status constraint
ALTER TABLE return_shipments DROP CONSTRAINT IF EXISTS return_shipments_status_check_new;
ALTER TABLE return_shipments ADD CONSTRAINT return_shipments_status_check_new
  CHECK (status IN (
    'awaiting_tracking', 'in_transit', 'delivered_to_hub', 'inspection_in_progress',
    'vendor_approved', 'approved', 'refund_processing', 'refund_completed', 'refund_failed',
    'rejected', 'pickup_scheduled', 'awaiting_dropoff', 'pending', 'delivered', 'completed'
  ));

-- 2. vendor_return_debits table
CREATE TABLE IF NOT EXISTS vendor_return_debits (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id           uuid NOT NULL REFERENCES vendors(id),
  return_request_id   uuid NOT NULL REFERENCES return_requests(id),
  -- estimated at approval time; updated to actual refund_amount when refund completes
  amount              numeric(12,2) NOT NULL DEFAULT 0,
  status              text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'deducted', 'paid_back', 'waived')),
  -- how the debt was/will be recovered
  recovery_method     text CHECK (recovery_method IN ('deduction', 'paystack', 'bank_transfer', 'waived')),
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vendor_return_debits_vendor_id_idx ON vendor_return_debits(vendor_id);
CREATE INDEX IF NOT EXISTS vendor_return_debits_return_request_id_idx ON vendor_return_debits(return_request_id);

-- 3. Rebuild vendor_earnings_summary to subtract pending/deducted debits
DROP VIEW IF EXISTS vendor_earnings_summary;
CREATE VIEW vendor_earnings_summary AS
SELECT
  v.id                                                                          AS vendor_id,
  COUNT(DISTINCT oi.order_id)                                                   AS total_orders,
  COALESCE(SUM(oi.subtotal), 0)                                                 AS gross_sales,
  COALESCE(SUM(oi.subtotal * v.commission_rate / 100), 0)                       AS platform_commission,
  COALESCE(SUM(oi.subtotal * (1 - v.commission_rate / 100)), 0)                 AS net_earnings,
  COALESCE(wd.total_withdrawn, 0)                                               AS total_withdrawn,
  COALESCE(rd.total_debits, 0)                                                  AS total_return_debits,
  COALESCE(SUM(oi.subtotal * (1 - v.commission_rate / 100)), 0)
    - COALESCE(wd.total_withdrawn, 0)
    - COALESCE(rd.total_debits, 0)                                              AS available_balance
FROM vendors v
LEFT JOIN order_items oi ON oi.vendor_id = v.id
LEFT JOIN orders o       ON o.id = oi.order_id AND o.payment_status = 'paid'
LEFT JOIN (
  SELECT vendor_id, SUM(amount) AS total_withdrawn
  FROM vendor_withdrawals
  WHERE status = 'paid'
  GROUP BY vendor_id
) wd ON wd.vendor_id = v.id
LEFT JOIN (
  -- pending = held against future withdrawals; deducted = already offset
  SELECT vendor_id, SUM(amount) AS total_debits
  FROM vendor_return_debits
  WHERE status IN ('pending', 'deducted')
  GROUP BY vendor_id
) rd ON rd.vendor_id = v.id
GROUP BY v.id, wd.total_withdrawn, rd.total_debits;
