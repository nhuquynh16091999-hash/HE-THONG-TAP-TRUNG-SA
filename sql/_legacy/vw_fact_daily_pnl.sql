-- ============================================================
-- vw_fact_daily_pnl — Daily Profit & Loss (GOLD VIEW)
-- Owner: A10 (Finance Analyst)
-- Rewritten for actual BQ schema
-- ============================================================
-- Aggregates daily P&L from vw_fact_orders.
-- Note: No COGS data available (sale_order_line has no unit price)
-- Revenue = COD + prepaid for success orders
-- ============================================================

CREATE OR REPLACE VIEW `{PROJECT}.{DATASET}.vw_fact_daily_pnl` AS

SELECT
  o.order_date,
  o.shop_id,
  
  -- ==================== Revenue ====================
  SUM(CASE WHEN o.is_success THEN o.gross_revenue ELSE 0 END) AS gross_revenue,
  
  -- ==================== Operating Costs ====================
  SUM(o.carrier_fee) AS shipping_cost,
  SUM(CASE WHEN o.is_returned OR o.is_partial_return THEN o.carrier_fee ELSE 0 END) AS return_cost,
  
  -- ==================== Operating Profit ====================
  SUM(CASE WHEN o.is_success THEN o.gross_revenue ELSE 0 END)
    - SUM(o.carrier_fee)
    AS operating_profit,
  
  -- ==================== Margins ====================
  SAFE_DIVIDE(
    SUM(CASE WHEN o.is_success THEN o.gross_revenue ELSE 0 END) - SUM(o.carrier_fee),
    NULLIF(SUM(CASE WHEN o.is_success THEN o.gross_revenue ELSE 0 END), 0)
  ) AS operating_margin_pct,
  
  -- ==================== Discounts ====================
  SUM(o.shipping_fee_from_customer) AS shipping_charged_to_customer,
  
  -- ==================== Order Counts ====================
  COUNT(*) AS total_orders,
  COUNTIF(o.is_success) AS success_orders,
  COUNTIF(o.is_returned) AS returned_orders,
  COUNTIF(o.is_partial_return) AS partial_return_orders,
  COUNTIF(o.is_canceled) AS canceled_orders,
  COUNTIF(o.status_group = 'processing') AS processing_orders,
  COUNTIF(o.status_group = 'in_transit') AS in_transit_orders,
  
  -- ==================== Success Rate ====================
  SAFE_DIVIDE(
    COUNTIF(o.is_success),
    NULLIF(COUNT(*), 0)
  ) AS success_rate,
  
  SAFE_DIVIDE(
    COUNTIF(o.is_returned),
    NULLIF(COUNT(*), 0)
  ) AS return_rate,
  
  -- ==================== Payment Mix ====================
  SUM(o.cod_amount) AS total_cod,
  SUM(o.total_prepaid) AS total_prepaid,
  
  -- ==================== Reconciliation ====================
  SUM(o.cod_reconciled) AS carrier_collected,
  SUM(o.reconciliation_gap) AS reconciliation_gap,
  
  -- ==================== Averages ====================
  SAFE_DIVIDE(
    SUM(CASE WHEN o.is_success THEN o.gross_revenue ELSE 0 END),
    NULLIF(COUNTIF(o.is_success), 0)
  ) AS avg_order_value,
  
  -- ==================== Customer Type Mix ====================
  COUNTIF(o.customer_type = 'New') AS new_customer_orders,
  COUNTIF(o.customer_type = 'Returning') AS returning_customer_orders,

FROM `{PROJECT}.{DATASET}.vw_fact_orders` o
GROUP BY o.order_date, o.shop_id;
