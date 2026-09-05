-- TALPHA Daily P&L View
-- Joins orders (COD) + ads spend per day
-- Uses ads_product_mapping for product attribution with effective_from for immutable history

CREATE OR REPLACE VIEW `levelup-465304.TALPHA_Dataset.vw_talpha_daily_pnl` AS

WITH daily_orders AS (
  SELECT
    DATE(PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%S', so.inserted_at)) AS order_date,
    so.shop_name,
    COUNT(DISTINCT so.id) AS total_orders,
    COUNTIF(so.status IN (2, 3, 4, 5)) AS confirmed_orders,
    COUNTIF(so.status IN (8, 9)) AS shipped_orders,
    COUNTIF(so.status = 2) AS delivered_orders,
    COUNTIF(so.status IN (13, 15, 16)) AS returned_orders,
    SUM(CASE WHEN so.status IN (2, 3, 4, 5, 8, 9) THEN so.total_price ELSE 0 END) AS gross_revenue,
    SUM(CASE WHEN so.status = 2 THEN so.total_price ELSE 0 END) AS collected_revenue,
    SUM(so.shipping_fee) AS total_shipping_fee,
    SUM(so.partner_fee) AS total_partner_fee,
    SUM(so.return_fee) AS total_return_fee,
    SUM(so.cod) AS total_cod,
    SUM(so.surcharge) AS total_surcharge
  FROM `levelup-465304.TALPHA_Dataset.sale_order` so
  GROUP BY 1, 2
),

daily_ads AS (
  SELECT
    DATE(f.date_start) AS ad_date,
    SUM(f.spend) AS total_spend,
    SUM(f.impressions) AS total_impressions,
    SUM(f.reach) AS total_reach,
    SUM(f.clicks) AS total_clicks,
    SUM(CAST(f.actions_message AS INT64)) AS total_messages,
    SUM(CAST(f.actions_purchase AS INT64)) AS total_purchases,
    SUM(f.action_values_purchase) AS total_purchase_value
  FROM `levelup-465304.TALPHA_Dataset.fb_ads_data` f
  GROUP BY 1
)

SELECT
  COALESCE(o.order_date, a.ad_date) AS date,
  o.shop_name,
  -- Orders
  COALESCE(o.total_orders, 0) AS total_orders,
  COALESCE(o.confirmed_orders, 0) AS confirmed_orders,
  COALESCE(o.shipped_orders, 0) AS shipped_orders,
  COALESCE(o.delivered_orders, 0) AS delivered_orders,
  COALESCE(o.returned_orders, 0) AS returned_orders,
  -- Revenue
  COALESCE(o.gross_revenue, 0) AS gross_revenue,
  COALESCE(o.collected_revenue, 0) AS collected_revenue,
  -- Costs
  COALESCE(o.total_shipping_fee, 0) AS shipping_fee,
  COALESCE(o.total_partner_fee, 0) AS partner_fee,
  COALESCE(o.total_return_fee, 0) AS return_fee,
  COALESCE(a.total_spend, 0) AS ads_spend,
  -- Metrics
  COALESCE(a.total_impressions, 0) AS impressions,
  COALESCE(a.total_messages, 0) AS messages,
  COALESCE(a.total_purchases, 0) AS purchases,
  -- P&L
  COALESCE(o.gross_revenue, 0) - COALESCE(a.total_spend, 0) - COALESCE(o.total_shipping_fee, 0)
    - COALESCE(o.total_partner_fee, 0) - COALESCE(o.total_return_fee, 0) AS net_profit,
  -- KPIs
  SAFE_DIVIDE(COALESCE(o.gross_revenue, 0), NULLIF(COALESCE(a.total_spend, 0), 0)) AS roas,
  SAFE_DIVIDE(COALESCE(a.total_spend, 0), NULLIF(COALESCE(o.confirmed_orders, 0), 0)) AS cpo,
  SAFE_DIVIDE(COALESCE(a.total_spend, 0), NULLIF(COALESCE(a.total_messages, 0), 0)) AS cost_per_msg,
  SAFE_DIVIDE(COALESCE(a.total_spend, 0), NULLIF(COALESCE(a.total_impressions, 0), 0)) * 1000 AS cpm,
  SAFE_DIVIDE(COALESCE(o.returned_orders, 0), NULLIF(COALESCE(o.total_orders, 0), 0)) AS return_rate
FROM daily_orders o
FULL OUTER JOIN daily_ads a ON o.order_date = a.ad_date
ORDER BY date DESC;
