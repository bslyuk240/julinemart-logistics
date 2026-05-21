-- Fix Supabase security lints
-- 1. Recreate 4 views with security_invoker = true  (was implicitly SECURITY DEFINER)
-- 2. Enable RLS + add policies on vendor_return_debits

-- ─────────────────────────────────────────────────────────────────────────────
-- 1a. pending_courier_payments  (from courier_settlements migration)
-- ─────────────────────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS pending_courier_payments;
CREATE VIEW pending_courier_payments WITH (security_invoker = true) AS
SELECT
  c.id                          AS courier_id,
  c.name                        AS courier_name,
  c.code                        AS courier_code,
  COUNT(so.id)                  AS pending_shipments,
  SUM(so.real_shipping_cost)    AS total_amount_due,
  MAX(so.created_at)            AS last_shipment_date
FROM couriers c
JOIN sub_orders so ON so.courier_id = c.id
WHERE so.status = 'delivered'
  AND (so.allocated_shipping_fee IS NULL OR so.allocated_shipping_fee = 0)
GROUP BY c.id, c.name, c.code;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1b. vendor_monthly_earnings  (from create_finance_tables_views migration)
-- ─────────────────────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS vendor_monthly_earnings;
CREATE VIEW vendor_monthly_earnings WITH (security_invoker = true) AS
SELECT
  oi.vendor_id,
  DATE_TRUNC('month', o.created_at)                               AS month,
  COUNT(DISTINCT oi.order_id)                                     AS orders,
  COALESCE(SUM(oi.subtotal), 0)                                   AS gross_sales,
  COALESCE(SUM(oi.subtotal * v.commission_rate / 100), 0)         AS platform_commission,
  COALESCE(SUM(oi.subtotal * (1 - v.commission_rate / 100)), 0)   AS net_earnings
FROM order_items oi
JOIN orders  o ON o.id = oi.order_id  AND o.payment_status = 'paid'
JOIN vendors v ON v.id = oi.vendor_id
GROUP BY oi.vendor_id, DATE_TRUNC('month', o.created_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- 1c. vendor_earnings_summary  (latest version: includes return debits)
-- ─────────────────────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS vendor_earnings_summary;
CREATE VIEW vendor_earnings_summary WITH (security_invoker = true) AS
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
  SELECT vendor_id, SUM(amount) AS total_debits
  FROM vendor_return_debits
  WHERE status IN ('pending', 'deducted')
  GROUP BY vendor_id
) rd ON rd.vendor_id = v.id
GROUP BY v.id, wd.total_withdrawn, rd.total_debits;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1d. monthly_pnl_view  (from create_finance_tables_views migration)
-- ─────────────────────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS monthly_pnl_view;
CREATE VIEW monthly_pnl_view WITH (security_invoker = true) AS
WITH
order_level AS (
  SELECT
    DATE_TRUNC('month', created_at)  AS month,
    SUM(shipping_fee_paid)            AS shipping_revenue,
    SUM(COALESCE(tax_amount, 0))      AS vat_collected,
    COUNT(*)                          AS order_count
  FROM orders
  WHERE payment_status = 'paid'
  GROUP BY DATE_TRUNC('month', created_at)
),
item_level AS (
  SELECT
    DATE_TRUNC('month', o.created_at)                                     AS month,
    COALESCE(SUM(oi.subtotal), 0)                                          AS gross_sales,
    COALESCE(SUM(
      CASE WHEN oi.vendor_id IS NOT NULL
           THEN oi.subtotal * COALESCE(v.commission_rate, 0) / 100
           ELSE 0 END
    ), 0)                                                                   AS commission_revenue,
    COALESCE(SUM(
      CASE WHEN oi.vendor_id IS NULL THEN oi.subtotal ELSE 0 END
    ), 0)                                                                   AS margin_revenue
  FROM orders o
  JOIN order_items oi ON oi.order_id = o.id
  LEFT JOIN vendors v ON v.id = oi.vendor_id
  WHERE o.payment_status = 'paid'
  GROUP BY DATE_TRUNC('month', o.created_at)
),
monthly_expenses AS (
  SELECT
    DATE_TRUNC('month', paid_at)  AS month,
    SUM(amount)                    AS expenses
  FROM ledger_expenses
  GROUP BY DATE_TRUNC('month', paid_at)
)
SELECT
  TO_CHAR(il.month, 'YYYY-MM')                                                AS period,
  il.commission_revenue + il.margin_revenue + ol.shipping_revenue              AS revenue,
  il.commission_revenue,
  il.margin_revenue,
  ol.shipping_revenue,
  il.gross_sales,
  COALESCE(me.expenses, 0)                                                      AS expenses,
  (il.commission_revenue + il.margin_revenue + ol.shipping_revenue)
    - COALESCE(me.expenses, 0)                                                  AS gross_profit,
  CASE
    WHEN (il.commission_revenue + il.margin_revenue + ol.shipping_revenue) > 0
    THEN ROUND(
      ((il.commission_revenue + il.margin_revenue + ol.shipping_revenue) - COALESCE(me.expenses, 0))
      / (il.commission_revenue + il.margin_revenue + ol.shipping_revenue) * 100,
      2
    )
    ELSE 0
  END                                                                           AS profit_margin_pct,
  ol.vat_collected,
  ol.order_count
FROM item_level il
JOIN order_level ol    ON ol.month = il.month
LEFT JOIN monthly_expenses me ON me.month = il.month
ORDER BY il.month DESC;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Enable RLS on vendor_return_debits + add policies
--    All Netlify/edge functions use the service_role key → unaffected.
--    Admins/managers can manage via dashboard. Regular users see nothing.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE vendor_return_debits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_vendor_return_debits"
  ON vendor_return_debits
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "admin_manage_vendor_return_debits"
  ON vendor_return_debits
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
        AND users.role IN ('admin', 'manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
        AND users.role IN ('admin', 'manager')
    )
  );
