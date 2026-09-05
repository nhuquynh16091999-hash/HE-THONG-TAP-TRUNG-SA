-- ╔══════════════════════════════════════════════════════════╗
-- ║  vw_fact_product_perf: Product performance               ║
-- ║  Revenue, COGS, margin, return rate per product          ║
-- ╚══════════════════════════════════════════════════════════╝

CREATE OR REPLACE VIEW `{PROJECT}.{DATASET}.vw_fact_product_perf` AS

SELECT
  COALESCE(sp.project_id, oi.project_id) AS project_id,
  COALESCE(sp.market_code, '') AS market_code,
  COALESCE(sp.currency, 'USD') AS currency,
  COALESCE(sp.currency_divisor, 1) AS currency_divisor,
  oi.shop_name,
  oi.product_id,
  oi.product_name,
  oi.variation_name,
  oi.barcode,
  -- Volume
  SUM(oi.quantity) AS total_sold,
  SUM(oi.return_quantity + oi.returned_count) AS total_returned,
  -- Revenue (normalized)
  SUM(oi.quantity * oi.retail_price) / COALESCE(sp.currency_divisor, 1) AS revenue,
  SUM(oi.quantity * oi.retail_price - oi.total_discount) / COALESCE(sp.currency_divisor, 1) AS revenue_after_discount,
  -- COGS (normalized)
  SUM(oi.quantity * oi.avg_imported_price) / COALESCE(sp.currency_divisor, 1) AS cogs,
  AVG(oi.avg_imported_price) / COALESCE(sp.currency_divisor, 1) AS avg_cogs_per_unit,
  AVG(oi.retail_price) / COALESCE(sp.currency_divisor, 1) AS avg_retail_price,
  -- Gross Profit
  (SUM(oi.quantity * oi.retail_price - oi.total_discount) - SUM(oi.quantity * oi.avg_imported_price)) / COALESCE(sp.currency_divisor, 1) AS gross_profit,
  -- Gross Margin
  SAFE_DIVIDE(
    SUM(oi.quantity * oi.retail_price - oi.total_discount) - SUM(oi.quantity * oi.avg_imported_price),
    NULLIF(SUM(oi.quantity * oi.retail_price - oi.total_discount), 0)
  ) AS gross_margin,
  -- Return rate
  SAFE_DIVIDE(
    SUM(oi.return_quantity + oi.returned_count),
    NULLIF(SUM(oi.quantity), 0)
  ) AS return_rate,
  -- Counts
  COUNTIF(oi.is_bonus_product) AS bonus_count,
  COUNTIF(oi.is_wholesale) AS wholesale_count,
  COUNT(DISTINCT oi.order_id) AS order_count,
  MIN(oi.order_inserted_at) AS first_sold_at,
  MAX(oi.order_inserted_at) AS last_sold_at
FROM `{PROJECT}.{DATASET}.order_items` oi
LEFT JOIN `{PROJECT}.Zen8_Dataset.dim_shop_project` sp ON oi.shop_id = sp.shop_id
WHERE oi.avg_imported_price > 0
GROUP BY 1,2,3,4,5,6,7,8,9
;
