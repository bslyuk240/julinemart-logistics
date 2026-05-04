-- ─────────────────────────────────────────────────────────────────────────────
-- Finance tables & views
-- Fixes: admin Finance page (monthly_pnl_view, ledger_expenses),
--        vendor portal (vendor_earnings_summary, vendor_monthly_earnings,
--        vendor_withdrawals), and missing schema columns.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Missing columns ────────────────────────────────────────────────────────

-- order_items: cost price snapshot at time of order (for COGS tracking)
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS cost_price DECIMAL(10,2);

-- order_number is served by woocommerce_order_id; vendor portal JS updated to match.

-- ── 2. ledger_expenses ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ledger_expenses (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  source           VARCHAR(50)   NOT NULL DEFAULT 'manual',
  category         VARCHAR(100)  NOT NULL,
  subcategory      VARCHAR(100),
  description      TEXT          NOT NULL,
  amount           DECIMAL(12,2) NOT NULL CHECK (amount > 0),
  currency         VARCHAR(10)   NOT NULL DEFAULT 'NGN',
  tax_deductible   BOOLEAN       NOT NULL DEFAULT true,
  vat_amount       DECIMAL(10,2) NOT NULL DEFAULT 0,
  payment_method   VARCHAR(50),
  paid_to          VARCHAR(255),
  paid_at          TIMESTAMP     NOT NULL,
  fiscal_year      INTEGER,
  fiscal_month     INTEGER,
  reference_id     UUID,
  reference_type   VARCHAR(50),
  created_at       TIMESTAMP     NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ledger_expenses_paid_at  ON ledger_expenses(paid_at DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_expenses_category ON ledger_expenses(category);
CREATE INDEX IF NOT EXISTS idx_ledger_expenses_fiscal   ON ledger_expenses(fiscal_year, fiscal_month);

DROP TRIGGER IF EXISTS update_ledger_expenses_updated_at ON ledger_expenses;
CREATE TRIGGER update_ledger_expenses_updated_at
  BEFORE UPDATE ON ledger_expenses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── 3. vendor_withdrawals ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS vendor_withdrawals (
  id                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id            UUID          NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  amount               DECIMAL(12,2) NOT NULL CHECK (amount > 0),
  status               VARCHAR(50)   NOT NULL DEFAULT 'pending',
  bank_name            VARCHAR(100),
  bank_account_number  VARCHAR(50),
  bank_account_name    VARCHAR(100),
  notes                TEXT,
  payment_reference    VARCHAR(100),
  payment_date         TIMESTAMP,
  reviewed_by          UUID          REFERENCES users(id),
  reviewed_at          TIMESTAMP,
  created_at           TIMESTAMP     NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMP     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vendor_withdrawals_vendor ON vendor_withdrawals(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_withdrawals_status ON vendor_withdrawals(status);

DROP TRIGGER IF EXISTS update_vendor_withdrawals_updated_at ON vendor_withdrawals;
CREATE TRIGGER update_vendor_withdrawals_updated_at
  BEFORE UPDATE ON vendor_withdrawals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── 4. vendor_earnings_summary ───────────────────────────────────────────────
-- One row per vendor. Includes vendors with zero sales.

DROP VIEW IF EXISTS monthly_pnl_view;
DROP VIEW IF EXISTS vendor_monthly_earnings;
DROP VIEW IF EXISTS vendor_earnings_summary;

CREATE VIEW vendor_earnings_summary AS
SELECT
  v.id                                                            AS vendor_id,
  COUNT(DISTINCT oi.order_id)                                     AS total_orders,
  COALESCE(SUM(oi.subtotal), 0)                                   AS gross_sales,
  COALESCE(SUM(oi.subtotal * v.commission_rate / 100), 0)         AS platform_commission,
  COALESCE(SUM(oi.subtotal * (1 - v.commission_rate / 100)), 0)   AS net_earnings,
  COALESCE(wd.total_withdrawn, 0)                                 AS total_withdrawn,
  COALESCE(SUM(oi.subtotal * (1 - v.commission_rate / 100)), 0)
    - COALESCE(wd.total_withdrawn, 0)                             AS available_balance
FROM vendors v
LEFT JOIN order_items oi ON oi.vendor_id = v.id
LEFT JOIN orders o       ON o.id = oi.order_id AND o.payment_status = 'paid'
LEFT JOIN (
  SELECT vendor_id, SUM(amount) AS total_withdrawn
  FROM vendor_withdrawals
  WHERE status = 'paid'
  GROUP BY vendor_id
) wd ON wd.vendor_id = v.id
GROUP BY v.id, wd.total_withdrawn;

-- ── 5. vendor_monthly_earnings ───────────────────────────────────────────────

CREATE VIEW vendor_monthly_earnings AS
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

-- ── 6. monthly_pnl_view ───────────────────────────────────────────────────────
-- Admin Finance P&L.
--
-- Revenue = commission_revenue + margin_revenue + shipping_revenue
--   commission_revenue : vendor items × commission_rate
--   margin_revenue     : JulineMart's own items (vendor_id IS NULL)
--   shipping_revenue   : shipping_fee_paid per order (aggregated at order level
--                        first to avoid duplication across multiple line items)
--
-- Expenses come from ledger_expenses.

CREATE VIEW monthly_pnl_view AS
WITH
-- Aggregate shipping & VAT at the order level (one row per order)
order_level AS (
  SELECT
    DATE_TRUNC('month', created_at) AS month,
    SUM(shipping_fee_paid)           AS shipping_revenue,
    SUM(COALESCE(tax_amount, 0))     AS vat_collected,
    COUNT(*)                         AS order_count
  FROM orders
  WHERE payment_status = 'paid'
  GROUP BY DATE_TRUNC('month', created_at)
),
-- Aggregate line-item revenue at the item level
item_level AS (
  SELECT
    DATE_TRUNC('month', o.created_at)                                   AS month,
    COALESCE(SUM(oi.subtotal), 0)                                        AS gross_sales,
    COALESCE(SUM(
      CASE WHEN oi.vendor_id IS NOT NULL
           THEN oi.subtotal * COALESCE(v.commission_rate, 0) / 100
           ELSE 0 END
    ), 0)                                                                 AS commission_revenue,
    COALESCE(SUM(
      CASE WHEN oi.vendor_id IS NULL THEN oi.subtotal ELSE 0 END
    ), 0)                                                                 AS margin_revenue
  FROM orders o
  JOIN order_items oi ON oi.order_id = o.id
  LEFT JOIN vendors v ON v.id = oi.vendor_id
  WHERE o.payment_status = 'paid'
  GROUP BY DATE_TRUNC('month', o.created_at)
),
monthly_expenses AS (
  SELECT
    DATE_TRUNC('month', paid_at) AS month,
    SUM(amount)                   AS expenses
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
JOIN order_level ol ON ol.month = il.month
LEFT JOIN monthly_expenses me ON me.month = il.month
ORDER BY il.month DESC;
