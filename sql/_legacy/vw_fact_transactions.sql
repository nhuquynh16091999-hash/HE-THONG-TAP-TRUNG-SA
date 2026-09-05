-- ============================================================
-- vw_fact_transactions — Transaction View
-- Rewritten for actual BQ schema
-- ============================================================
-- NOTE: No 'transactions' table exists in BQ.
-- This view is a PLACEHOLDER for when transaction data
-- is added (e.g., from Pancake Finance module or manual import).
-- Currently returns empty result set with correct schema.
-- ============================================================

CREATE OR REPLACE VIEW `{PROJECT}.{DATASET}.vw_fact_transactions` AS

-- Derive basic transaction-like data from orders
SELECT
  order_id AS transaction_id,
  order_date AS transaction_date,
  created_at,
  shop_id,
  
  -- Direction based on order status
  CASE
    WHEN is_success THEN 'income'
    WHEN is_returned THEN 'expense'
    ELSE 'pending'
  END AS direction,
  
  -- Amount
  CASE
    WHEN is_success THEN gross_revenue
    WHEN is_returned THEN -carrier_fee
    ELSE 0
  END AS amount,
  
  -- Classification
  'order' AS source_type,
  carrier_name,
  order_source_name,

FROM `{PROJECT}.{DATASET}.vw_fact_orders`;
