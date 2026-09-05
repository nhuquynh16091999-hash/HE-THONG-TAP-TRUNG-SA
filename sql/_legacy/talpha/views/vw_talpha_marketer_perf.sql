-- TALPHA Marketer Performance View
-- Per-marketer metrics: ads spend, orders, revenue, ROAS

CREATE OR REPLACE VIEW `levelup-465304.TALPHA_Dataset.vw_talpha_marketer_perf` AS

WITH marketer_ads AS (
  SELECT
    TRIM(SPLIT(f.campaign_name, '/')[SAFE_OFFSET(3)]) AS marketer_code,
    SUM(f.spend) AS ads_spend,
    SUM(f.impressions) AS impressions,
    SUM(f.reach) AS reach,
    SUM(f.clicks) AS clicks,
    SUM(CAST(f.actions_message AS INT64)) AS messages,
    SUM(CAST(f.actions_purchase AS INT64)) AS purchases,
    SUM(f.action_values_purchase) AS purchase_value,
    COUNT(DISTINCT f.campaign_id) AS campaigns,
    COUNT(DISTINCT f.ad_id) AS ads_count,
    COUNT(DISTINCT DATE(f.date_start)) AS active_days
  FROM `levelup-465304.TALPHA_Dataset.fb_ads_data` f
  WHERE f.campaign_name IS NOT NULL
    AND ARRAY_LENGTH(SPLIT(f.campaign_name, '/')) >= 4
  GROUP BY 1
),

marketer_orders AS (
  SELECT
    so.marketer AS marketer_name,
    COUNT(DISTINCT so.id) AS total_orders,
    COUNTIF(so.status IN (2, 3, 4, 5)) AS confirmed_orders,
    COUNTIF(so.status = 2) AS delivered_orders,
    COUNTIF(so.status IN (13, 15, 16)) AS returned_orders,
    SUM(CASE WHEN so.status IN (2, 3, 4, 5, 8, 9) THEN so.total_price ELSE 0 END) AS gross_revenue,
    SUM(CASE WHEN so.status = 2 THEN so.total_price ELSE 0 END) AS collected_revenue
  FROM `levelup-465304.TALPHA_Dataset.sale_order` so
  WHERE so.marketer IS NOT NULL AND so.marketer != ''
  GROUP BY 1
)

SELECT
  COALESCE(ma.marketer_code, mo.marketer_name) AS marketer,
  -- Ads
  COALESCE(ma.ads_spend, 0) AS ads_spend,
  COALESCE(ma.impressions, 0) AS impressions,
  COALESCE(ma.reach, 0) AS reach,
  COALESCE(ma.messages, 0) AS messages,
  COALESCE(ma.purchases, 0) AS purchases,
  COALESCE(ma.campaigns, 0) AS campaigns,
  COALESCE(ma.active_days, 0) AS active_days,
  -- Orders
  COALESCE(mo.total_orders, 0) AS total_orders,
  COALESCE(mo.confirmed_orders, 0) AS confirmed_orders,
  COALESCE(mo.returned_orders, 0) AS returned_orders,
  -- Revenue
  COALESCE(mo.gross_revenue, 0) AS gross_revenue,
  COALESCE(mo.collected_revenue, 0) AS collected_revenue,
  -- KPIs
  SAFE_DIVIDE(COALESCE(mo.gross_revenue, 0), NULLIF(COALESCE(ma.ads_spend, 0), 0)) AS roas,
  SAFE_DIVIDE(COALESCE(ma.ads_spend, 0), NULLIF(COALESCE(mo.confirmed_orders, 0), 0)) AS cpo,
  SAFE_DIVIDE(COALESCE(ma.ads_spend, 0), NULLIF(COALESCE(ma.messages, 0), 0)) AS cost_per_msg,
  SAFE_DIVIDE(COALESCE(ma.ads_spend, 0), NULLIF(COALESCE(ma.impressions, 0), 0)) * 1000 AS cpm,
  SAFE_DIVIDE(COALESCE(mo.returned_orders, 0), NULLIF(COALESCE(mo.total_orders, 0), 0)) AS return_rate
FROM marketer_ads ma
FULL OUTER JOIN marketer_orders mo ON LOWER(ma.marketer_code) = LOWER(mo.marketer_name)
ORDER BY ads_spend DESC;
