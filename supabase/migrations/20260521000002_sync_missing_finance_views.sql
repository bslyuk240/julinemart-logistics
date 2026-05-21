-- Sync 8 finance/ledger views that exist in production but had no local migration.
-- These were created directly in the Supabase dashboard.
-- SQL bodies are exact copies of the live pg_views definitions.

-- ─────────────────────────────────────────────────────────────────────────────
-- finance_revenue_view
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW finance_revenue_view WITH (security_invoker = true) AS
SELECT
  id,
  source,
  order_id,
  commission_amount,
  shipping_margin,
  platform_fee,
  other_revenue,
  amount,
  currency,
  vat_applicable,
  vat_amount,
  vat_rate,
  received_at,
  fiscal_year,
  fiscal_month,
  date_trunc('month', received_at)   AS period_month,
  date_trunc('quarter', received_at) AS period_quarter,
  description,
  created_at
FROM ledger_revenue
ORDER BY received_at DESC;

-- ─────────────────────────────────────────────────────────────────────────────
-- finance_expenses_view
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW finance_expenses_view WITH (security_invoker = true) AS
SELECT
  id,
  source,
  source_reference,
  category,
  subcategory,
  amount,
  currency,
  tax_deductible,
  vat_amount,
  payment_method,
  paid_to,
  paid_at,
  fiscal_year,
  fiscal_month,
  date_trunc('month', paid_at)   AS period_month,
  date_trunc('quarter', paid_at) AS period_quarter,
  description,
  created_at
FROM ledger_expenses
ORDER BY paid_at DESC;

-- ─────────────────────────────────────────────────────────────────────────────
-- revenue_by_source_view
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW revenue_by_source_view WITH (security_invoker = true) AS
SELECT
  source,
  date_trunc('month', received_at)    AS month,
  count(*)                             AS transaction_count,
  sum(amount)                          AS total_revenue,
  sum(commission_amount)               AS total_commission,
  sum(shipping_margin)                 AS total_shipping_margin,
  sum(vat_amount)                      AS total_vat,
  avg(amount)                          AS avg_revenue_per_transaction
FROM ledger_revenue
GROUP BY source, date_trunc('month', received_at)
ORDER BY date_trunc('month', received_at) DESC, sum(amount) DESC;

-- ─────────────────────────────────────────────────────────────────────────────
-- expense_by_category_view
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW expense_by_category_view WITH (security_invoker = true) AS
SELECT
  category,
  subcategory,
  source,
  date_trunc('month', paid_at)   AS month,
  count(*)                        AS transaction_count,
  sum(amount)                     AS total_amount,
  avg(amount)                     AS avg_amount,
  min(amount)                     AS min_amount,
  max(amount)                     AS max_amount,
  sum(CASE WHEN tax_deductible THEN amount ELSE 0 END)  AS deductible_amount,
  sum(CASE WHEN tax_deductible THEN 1 ELSE 0 END)       AS deductible_count
FROM ledger_expenses
GROUP BY category, subcategory, source, date_trunc('month', paid_at)
ORDER BY date_trunc('month', paid_at) DESC, sum(amount) DESC;

-- ─────────────────────────────────────────────────────────────────────────────
-- vat_summary_view
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW vat_summary_view WITH (security_invoker = true) AS
SELECT
  period_month,
  period_start,
  period_end,
  sum(vat_collected)  AS total_collected,
  sum(vat_payable)    AS total_payable,
  sum(net_vat)        AS net_vat_liability,
  count(*)            AS transaction_count,
  min(created_at)     AS first_transaction,
  max(created_at)     AS last_transaction
FROM ledger_vat
GROUP BY period_month, period_start, period_end
ORDER BY period_month DESC;

-- ─────────────────────────────────────────────────────────────────────────────
-- cash_flow_view
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW cash_flow_view WITH (security_invoker = true) AS
WITH
monthly_inflows AS (
  SELECT
    date_trunc('month', received_at)  AS month,
    sum(amount)                        AS inflow
  FROM ledger_revenue
  GROUP BY date_trunc('month', received_at)
),
monthly_outflows AS (
  SELECT
    date_trunc('month', paid_at)  AS month,
    sum(amount)                    AS outflow
  FROM ledger_expenses
  GROUP BY date_trunc('month', paid_at)
)
SELECT
  COALESCE(i.month, o.month)                                                   AS month,
  to_char(COALESCE(i.month, o.month), 'YYYY-MM')                               AS period,
  COALESCE(i.inflow, 0)                                                         AS cash_inflow,
  COALESCE(o.outflow, 0)                                                        AS cash_outflow,
  (COALESCE(i.inflow, 0) - COALESCE(o.outflow, 0))                             AS net_cash_flow,
  sum(COALESCE(i.inflow, 0) - COALESCE(o.outflow, 0))
    OVER (ORDER BY COALESCE(i.month, o.month))                                  AS cumulative_cash_flow
FROM monthly_inflows i
FULL JOIN monthly_outflows o ON i.month = o.month
ORDER BY COALESCE(i.month, o.month) DESC;

-- ─────────────────────────────────────────────────────────────────────────────
-- quarterly_pnl_view
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW quarterly_pnl_view WITH (security_invoker = true) AS
WITH
quarterly_revenue AS (
  SELECT
    date_trunc('quarter', received_at)  AS quarter,
    sum(amount)                          AS total_revenue,
    sum(commission_amount)               AS commission_revenue,
    sum(shipping_margin)                 AS shipping_revenue,
    sum(vat_amount)                      AS vat_collected
  FROM ledger_revenue
  GROUP BY date_trunc('quarter', received_at)
),
quarterly_expenses AS (
  SELECT
    date_trunc('quarter', paid_at)   AS quarter,
    sum(amount)                       AS total_expenses,
    sum(CASE WHEN tax_deductible THEN amount ELSE 0 END)  AS deductible_expenses,
    sum(vat_amount)                   AS vat_paid
  FROM ledger_expenses
  GROUP BY date_trunc('quarter', paid_at)
)
SELECT
  COALESCE(r.quarter, e.quarter)                                    AS quarter,
  to_char(COALESCE(r.quarter, e.quarter), 'YYYY-Q')                 AS period,
  COALESCE(r.total_revenue, 0)                                      AS revenue,
  COALESCE(e.total_expenses, 0)                                     AS expenses,
  (COALESCE(r.total_revenue, 0) - COALESCE(e.total_expenses, 0))    AS gross_profit,
  CASE
    WHEN COALESCE(r.total_revenue, 0) > 0
    THEN round(
      ((COALESCE(r.total_revenue, 0) - COALESCE(e.total_expenses, 0))
        / r.total_revenue) * 100,
      2
    )
    ELSE 0
  END                                                                AS profit_margin_pct
FROM quarterly_revenue r
FULL JOIN quarterly_expenses e ON r.quarter = e.quarter
ORDER BY COALESCE(r.quarter, e.quarter) DESC;

-- ─────────────────────────────────────────────────────────────────────────────
-- annual_tax_summary_view
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW annual_tax_summary_view WITH (security_invoker = true) AS
WITH
yearly_revenue AS (
  SELECT
    date_trunc('year', received_at)                                        AS year,
    sum(amount)                                                             AS total_revenue,
    sum(commission_amount)                                                  AS commission_revenue,
    sum(shipping_margin)                                                    AS shipping_revenue,
    sum(platform_fee)                                                       AS fee_revenue,
    sum(CASE WHEN vat_applicable THEN vat_amount ELSE 0 END)               AS total_vat_collected,
    count(*)                                                                AS revenue_transactions
  FROM ledger_revenue
  GROUP BY date_trunc('year', received_at)
),
yearly_expenses AS (
  SELECT
    date_trunc('year', paid_at)                                            AS year,
    sum(amount)                                                             AS total_expenses,
    sum(CASE WHEN tax_deductible THEN amount ELSE 0 END)                   AS deductible_expenses,
    sum(CASE WHEN NOT tax_deductible THEN amount ELSE 0 END)               AS non_deductible_expenses,
    sum(vat_amount)                                                         AS total_vat_paid,
    count(*)                                                                AS expense_transactions
  FROM ledger_expenses
  GROUP BY date_trunc('year', paid_at)
)
SELECT
  COALESCE(r.year, e.year)                                                  AS year,
  EXTRACT(year FROM COALESCE(r.year, e.year))::integer                      AS fiscal_year,
  COALESCE(r.total_revenue, 0)                                              AS total_revenue,
  COALESCE(r.commission_revenue, 0)                                         AS commission_revenue,
  COALESCE(r.shipping_revenue, 0)                                           AS shipping_revenue,
  COALESCE(r.fee_revenue, 0)                                                AS fee_revenue,
  COALESCE(r.revenue_transactions, 0)                                       AS revenue_transaction_count,
  COALESCE(e.total_expenses, 0)                                             AS total_expenses,
  COALESCE(e.deductible_expenses, 0)                                        AS tax_deductible_expenses,
  COALESCE(e.non_deductible_expenses, 0)                                    AS non_deductible_expenses,
  COALESCE(e.expense_transactions, 0)                                       AS expense_transaction_count,
  (COALESCE(r.total_revenue, 0) - COALESCE(e.total_expenses, 0))           AS gross_profit,
  (COALESCE(r.total_revenue, 0) - COALESCE(e.deductible_expenses, 0))      AS taxable_income,
  COALESCE(r.total_vat_collected, 0)                                        AS vat_collected,
  COALESCE(e.total_vat_paid, 0)                                             AS vat_paid,
  (COALESCE(r.total_vat_collected, 0) - COALESCE(e.total_vat_paid, 0))     AS net_vat_liability
FROM yearly_revenue r
FULL JOIN yearly_expenses e ON r.year = e.year
ORDER BY COALESCE(r.year, e.year) DESC;
