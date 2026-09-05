-- ============================================================
-- vw_dim_inventory_risk — Inventory Risk (GOLD VIEW)
-- Owner: A9 (Operations Analyst)
-- Rewritten for actual BQ schema (product_stock table)
-- ============================================================
-- Source: product_stock (161 rows, 14 columns)
-- Uses sale_order_line for sales velocity calculation
-- ============================================================

CREATE OR REPLACE VIEW `{PROJECT}.{DATASET}.vw_dim_inventory_risk` AS

WITH daily_sales AS (
  -- Average daily sales per product over last 30 days
  SELECT
    product_id,
    product_name,
    COUNT(DISTINCT order_id) AS orders_30d,
    SUM(quantity) AS units_sold_30d,
    SAFE_DIVIDE(SUM(quantity), 30) AS avg_daily_sales,
  FROM `{PROJECT}.{DATASET}.vw_fact_order_items`
  WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
    AND status_group IN ('success', 'in_transit', 'processing')
  GROUP BY product_id, product_name
)

SELECT
  ps.product_id,
  COALESCE(ds.product_name, ps.product_name) AS product_name,
  ps.product_variation_id AS variation_id,
  ps.warehouse_id,
  
  -- Stock levels
  COALESCE(ps.remain_quantity, 0) AS stock_level,
  COALESCE(ps.actual_remain_quantity, 0) AS actual_stock,
  COALESCE(ps.total_quantity, 0) AS total_quantity,
  COALESCE(ps.waiting_quantity, 0) AS waiting_quantity,
  COALESCE(ps.pending_quantity, 0) AS pending_quantity,
  
  -- Sales velocity
  COALESCE(ds.avg_daily_sales, 0) AS avg_daily_sales,
  COALESCE(ds.units_sold_30d, 0) AS units_sold_30d,
  COALESCE(ds.orders_30d, 0) AS orders_30d,
  COALESCE(ps.selling_avg, 0) AS selling_avg_from_source,
  
  -- Covering Days
  CASE
    WHEN COALESCE(ds.avg_daily_sales, 0) = 0 THEN 9999
    ELSE CAST(SAFE_DIVIDE(COALESCE(ps.remain_quantity, 0), ds.avg_daily_sales) AS INT64)
  END AS covering_days,
  
  -- Reorder Point = (Avg Daily x Lead Time 7d) + Safety Stock 3d
  CAST(COALESCE(ds.avg_daily_sales, 0) * 10 AS INT64) AS reorder_point,
  
  -- Safety Stock = 3 days of sales
  CAST(COALESCE(ds.avg_daily_sales, 0) * 3 AS INT64) AS safety_stock,
  
  -- Risk Level
  CASE
    WHEN COALESCE(ps.remain_quantity, 0) = 0 THEN 'OUT_OF_STOCK'
    WHEN COALESCE(ds.avg_daily_sales, 0) > 0 
      AND SAFE_DIVIDE(ps.remain_quantity, ds.avg_daily_sales) < 3 THEN 'CRITICAL'
    WHEN COALESCE(ds.avg_daily_sales, 0) > 0 
      AND SAFE_DIVIDE(ps.remain_quantity, ds.avg_daily_sales) < 7 THEN 'LOW'
    WHEN COALESCE(ds.avg_daily_sales, 0) > 0 
      AND SAFE_DIVIDE(ps.remain_quantity, ds.avg_daily_sales) < 14 THEN 'MEDIUM'
    ELSE 'OK'
  END AS risk_level,
  
  -- Action flags
  COALESCE(ps.remain_quantity, 0) < COALESCE(ds.avg_daily_sales, 0) * 10 AS needs_reorder,
  COALESCE(ps.remain_quantity, 0) < 50 AND COALESCE(ds.avg_daily_sales, 0) > 0 AS block_ads_scaling,

FROM `{PROJECT}.{DATASET}.product_stock` ps
LEFT JOIN daily_sales ds ON ps.product_id = ds.product_id
ORDER BY covering_days ASC;
