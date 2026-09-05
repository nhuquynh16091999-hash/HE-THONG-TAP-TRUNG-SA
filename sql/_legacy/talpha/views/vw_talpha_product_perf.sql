-- TALPHA Product Performance View
-- Per-product metrics using ads_product_mapping for attribution
-- Respects effective_from for immutable history

CREATE OR REPLACE VIEW `levelup-465304.TALPHA_Dataset.vw_talpha_product_perf` AS

WITH product_orders AS (
  SELECT
    oi.product_name,
    oi.product_id,
    oi.shop_name,
    COUNT(DISTINCT oi.order_id) AS order_count,
    SUM(oi.quantity) AS total_sold,
    SUM(oi.returned_count) AS total_returned,
    SUM(oi.quantity * oi.retail_price) AS revenue,
    SUM(oi.quantity * oi.retail_price - oi.discount_each_product) AS revenue_after_discount,
    SUM(oi.quantity * oi.avg_imported_price) AS cogs,
    AVG(oi.avg_imported_price) AS avg_cogs_per_unit,
    AVG(oi.retail_price) AS avg_retail_price,
    MIN(oi.order_inserted_at) AS first_sold_at,
    MAX(oi.order_inserted_at) AS last_sold_at,
    COUNTIF(oi.is_bonus_product) AS bonus_count
  FROM `levelup-465304.TALPHA_Dataset.order_items` oi
  GROUP BY 1, 2, 3
),

product_ads AS (
  SELECT
    m.primary_sku,
    m.primary_product_name,
    m.campaign_product_code,
    SUM(f.spend) AS ads_spend,
    SUM(f.impressions) AS impressions,
    SUM(CAST(f.actions_message AS INT64)) AS messages,
    SUM(CAST(f.actions_purchase AS INT64)) AS purchases
  FROM `levelup-465304.TALPHA_Dataset.ads_product_mapping` m
  JOIN `levelup-465304.TALPHA_Dataset.fb_ads_data` f
    ON TRIM(SPLIT(f.campaign_name, '/')[SAFE_OFFSET(2)]) = m.campaign_product_code
    AND TIMESTAMP(f.date_start) >= m.effective_from  -- Immutable: only apply mapping from effective date
  WHERE m.confidence IN ('HIGH', 'MEDIUM')
    AND m.is_test_product = false
  GROUP BY 1, 2, 3
)

SELECT
  COALESCE(po.product_name, pa.primary_product_name) AS product_name,
  COALESCE(pa.primary_sku, '') AS sku,
  po.shop_name,
  -- Volume
  COALESCE(po.total_sold, 0) AS total_sold,
  COALESCE(po.total_returned, 0) AS total_returned,
  COALESCE(po.order_count, 0) AS order_count,
  -- Revenue
  COALESCE(po.revenue, 0) AS revenue,
  COALESCE(po.revenue_after_discount, 0) AS revenue_after_discount,
  COALESCE(po.cogs, 0) AS cogs,
  -- Ads
  COALESCE(pa.ads_spend, 0) AS ads_spend,
  COALESCE(pa.impressions, 0) AS impressions,
  COALESCE(pa.messages, 0) AS messages,
  COALESCE(pa.purchases, 0) AS purchases,
  -- Profit
  COALESCE(po.revenue_after_discount, 0) - COALESCE(po.cogs, 0) AS gross_profit,
  SAFE_DIVIDE(
    COALESCE(po.revenue_after_discount, 0) - COALESCE(po.cogs, 0),
    NULLIF(COALESCE(po.revenue_after_discount, 0), 0)
  ) AS gross_margin,
  -- KPIs
  SAFE_DIVIDE(COALESCE(po.revenue, 0), NULLIF(COALESCE(pa.ads_spend, 0), 0)) AS roas,
  SAFE_DIVIDE(COALESCE(pa.ads_spend, 0), NULLIF(COALESCE(po.order_count, 0), 0)) AS cpo,
  SAFE_DIVIDE(COALESCE(po.total_returned, 0), NULLIF(COALESCE(po.total_sold, 0), 0)) AS return_rate,
  po.first_sold_at,
  po.last_sold_at
FROM product_orders po
FULL OUTER JOIN product_ads pa ON po.product_name LIKE CONCAT('%', pa.primary_sku, '%')
ORDER BY revenue DESC;
