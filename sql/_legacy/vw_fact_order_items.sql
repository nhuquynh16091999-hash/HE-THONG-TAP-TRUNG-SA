-- ============================================================
-- vw_fact_order_items — Order Line Items View
-- Rewritten for actual BQ schema (sale_order_line table)
-- ============================================================
-- Source: sale_order_line (40,603 rows, 16 columns)
-- Joins to vw_fact_orders for status/date context
-- Note: No unit price in source — only product_name, qty, discount
-- ============================================================

CREATE OR REPLACE VIEW `{PROJECT}.{DATASET}.vw_fact_order_items` AS

SELECT
  -- ==================== IDs ====================
  sol.sale_order_line_id AS line_item_id,
  sol.order_id,
  sol.product_id,
  COALESCE(sol.product_display_id, '') AS product_display_id,
  sol.product_varient_id AS variation_id,
  
  -- Join to base orders view for date/status context
  o.order_date,
  o.shop_id,
  o.status_label,
  o.status_group,
  o.is_success,
  o.carrier_name,
  o.marketer_name,
  
  -- ==================== Product Info ====================
  COALESCE(sol.product_name, 'Unknown') AS product_name,
  COALESCE(sol.product_varient_name, '') AS variation_name,
  
  -- ==================== Quantity ====================
  COALESCE(sol.quantity, 0) AS quantity,
  COALESCE(sol.return_quantity, 0) AS returned_count,
  COALESCE(sol.returning_quantity, 0) AS returning_count,
  COALESCE(sol.added_to_cart_quantity, 0) AS cart_quantity,
  
  -- Net quantity (sold minus returned)
  COALESCE(sol.quantity, 0) - COALESCE(sol.return_quantity, 0) AS net_quantity,
  
  -- ==================== Discount & Weight ====================
  COALESCE(sol.total_discount, 0) AS line_discount,
  COALESCE(sol.total_weight, 0) AS total_weight,

FROM `{PROJECT}.{DATASET}.sale_order_line` sol
INNER JOIN `{PROJECT}.{DATASET}.vw_fact_orders` o 
  ON sol.order_id = o.order_id;
