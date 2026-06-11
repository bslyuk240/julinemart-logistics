-- Fix vendor_earnings_summary: unpaid orders were counted in gross/net earnings
-- because order_items were LEFT JOINed while payment_status lived only in the
-- orders join condition (oi.subtotal still summed when o.id IS NULL).
-- Also reserve pending/approved withdrawal requests against available_balance.

DROP VIEW IF EXISTS vendor_earnings_summary;
CREATE VIEW vendor_earnings_summary WITH (security_invoker = true) AS
SELECT
  v.id                                                          AS vendor_id,
  COALESCE(paid.total_orders, 0)                                AS total_orders,
  COALESCE(paid.gross_sales, 0)                                 AS gross_sales,
  COALESCE(paid.platform_commission, 0)                         AS platform_commission,
  COALESCE(paid.net_earnings, 0)                                AS net_earnings,
  COALESCE(wd.total_withdrawn, 0)                               AS total_withdrawn,
  COALESCE(rd.total_debits, 0)                                  AS total_return_debits,
  COALESCE(pw.pending_withdrawals, 0)                           AS pending_withdrawals,
  GREATEST(
    0,
    COALESCE(paid.net_earnings, 0)
      - COALESCE(wd.total_withdrawn, 0)
      - COALESCE(rd.total_debits, 0)
      - COALESCE(pw.pending_withdrawals, 0)
  )                                                             AS available_balance
FROM vendors v
LEFT JOIN (
  SELECT
    oi.vendor_id,
    COUNT(DISTINCT oi.order_id)                                   AS total_orders,
    COALESCE(SUM(oi.subtotal), 0)                                 AS gross_sales,
    COALESCE(SUM(oi.subtotal * v.commission_rate / 100), 0)     AS platform_commission,
    COALESCE(SUM(oi.subtotal * (1 - v.commission_rate / 100)), 0) AS net_earnings
  FROM order_items oi
  INNER JOIN orders o ON o.id = oi.order_id AND o.payment_status = 'paid'
  INNER JOIN vendors v ON v.id = oi.vendor_id
  GROUP BY oi.vendor_id
) paid ON paid.vendor_id = v.id
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
LEFT JOIN (
  SELECT vendor_id, SUM(amount) AS pending_withdrawals
  FROM vendor_withdrawals
  WHERE status IN ('pending', 'approved')
  GROUP BY vendor_id
) pw ON pw.vendor_id = v.id;
