-- ╔═══════════════════════════════════════════════════════════╗
-- ║  vw_fact_ads_roas — TRUE ROAS per Ad                     ║
-- ║  Multi-level: ad_id match → adset_id fallback for UTM    ║
-- ╚═══════════════════════════════════════════════════════════╝

CREATE OR REPLACE VIEW `{PROJECT}.{DATASET}.vw_fact_ads_roas` AS

-- Step 1: Normalize ads_id in orders
WITH order_ads AS (
  SELECT
    order_id,
    shop_id,
    CAST(ads_id AS STRING) AS ads_id,
    page_id,
    page_name,
    ads_source,
    marketer,
    status,
    cod,
    money_to_collect,
    shipping_fee_from_customer,
    carrier_fee_paid,
    created_at,
    CAST(created_at AS DATE) AS order_date,
    CASE
      WHEN status IN ('6', '16') THEN 'success'
      WHEN status IN ('7') THEN 'returned'
      WHEN status IN ('8') THEN 'cancelled'
      ELSE 'processing'
    END AS status_group
  FROM `{PROJECT}.{DATASET}.sale_order`
  WHERE ads_id IS NOT NULL 
    AND CAST(ads_id AS STRING) NOT IN ('', '0', 'None', 'null')
),

-- Step 2: Aggregate ad spend at ad_id level
ad_spend AS (
  SELECT
    ad_id,
    ad_name,
    adset_id,
    campaign_id,
    page_id AS ad_page_id,
    SUM(SAFE_CAST(spend AS FLOAT64)) AS total_spend,
    SUM(SAFE_CAST(impressions AS INT64)) AS total_impressions,
    SUM(SAFE_CAST(reach AS INT64)) AS total_reach,
    MIN(date) AS first_date,
    MAX(date) AS last_date,
    COUNT(*) AS ad_days
  FROM `{PROJECT}.{DATASET}.fb_ads_data`
  WHERE ad_id IS NOT NULL AND ad_id != ''
  GROUP BY ad_id, ad_name, adset_id, campaign_id, page_id
),

-- Step 2b: Aggregate at adset level (for UTM landing page orders)
adset_spend AS (
  SELECT
    adset_id,
    MAX(ad_name) AS adset_top_ad,
    ANY_VALUE(campaign_id) AS campaign_id,
    ANY_VALUE(page_id) AS ad_page_id,
    SUM(SAFE_CAST(spend AS FLOAT64)) AS total_spend,
    SUM(SAFE_CAST(impressions AS INT64)) AS total_impressions,
    SUM(SAFE_CAST(reach AS INT64)) AS total_reach,
    MIN(date) AS first_date,
    MAX(date) AS last_date,
    COUNT(*) AS ad_days
  FROM `{PROJECT}.{DATASET}.fb_ads_data`
  WHERE adset_id IS NOT NULL AND adset_id != ''
  GROUP BY adset_id
),

-- Step 3a: Direct ad_id match (inbox orders)
direct_match AS (
  SELECT
    o.ads_id,
    a.ad_name,
    a.campaign_id,
    a.adset_id,
    a.ad_page_id,
    o.shop_id,
    o.page_name AS order_page_name,
    o.marketer,
    o.ads_source,
    'ad_id' AS match_type,
    o.order_id,
    o.status_group,
    o.cod,
    o.shipping_fee_from_customer,
    o.carrier_fee_paid,
    o.order_date,
    a.total_spend,
    a.total_impressions,
    a.total_reach,
    a.first_date AS ad_first_date,
    a.last_date AS ad_last_date
  FROM order_ads o
  INNER JOIN ad_spend a ON o.ads_id = a.ad_id
),

-- Step 3b: Adset_id match (landing page UTM orders - if not already matched)
adset_match AS (
  SELECT
    o.ads_id,
    s.adset_top_ad AS ad_name,
    s.campaign_id,
    o.ads_id AS adset_id,  -- ads_id IS the adset_id for these orders
    s.ad_page_id,
    o.shop_id,
    o.page_name AS order_page_name,
    o.marketer,
    o.ads_source,
    'adset_id' AS match_type,
    o.order_id,
    o.status_group,
    o.cod,
    o.shipping_fee_from_customer,
    o.carrier_fee_paid,
    o.order_date,
    s.total_spend,
    s.total_impressions,
    s.total_reach,
    s.first_date AS ad_first_date,
    s.last_date AS ad_last_date
  FROM order_ads o
  INNER JOIN adset_spend s ON o.ads_id = s.adset_id
  -- Only for orders NOT already matched at ad_id level
  WHERE o.order_id NOT IN (SELECT order_id FROM direct_match)
),

-- Union both match types
all_matched AS (
  SELECT * FROM direct_match
  UNION ALL
  SELECT * FROM adset_match
),

-- Step 4: Aggregate per ad
matched AS (
  SELECT
    ads_id,
    ad_name,
    campaign_id,
    adset_id,
    ad_page_id,
    shop_id,
    order_page_name,
    marketer,
    ads_source,
    ANY_VALUE(match_type) AS match_type,
    COUNT(DISTINCT order_id) AS total_orders,
    COUNTIF(status_group = 'success') AS success_orders,
    COUNTIF(status_group = 'returned') AS returned_orders,
    COUNTIF(status_group = 'cancelled') AS cancelled_orders,
    SUM(cod) AS total_cod,
    SUM(CASE WHEN status_group = 'success' THEN cod ELSE 0 END) AS success_cod,
    SUM(shipping_fee_from_customer) AS total_shipping_revenue,
    SUM(carrier_fee_paid) AS total_carrier_cost,
    MIN(order_date) AS first_order_date,
    MAX(order_date) AS last_order_date,
    ANY_VALUE(total_spend) AS total_spend,
    ANY_VALUE(total_impressions) AS total_impressions,
    ANY_VALUE(total_reach) AS total_reach,
    ANY_VALUE(ad_first_date) AS ad_first_date,
    ANY_VALUE(ad_last_date) AS ad_last_date,
    SAFE_DIVIDE(
      SUM(CASE WHEN status_group = 'success' THEN cod ELSE 0 END),
      ANY_VALUE(total_spend)
    ) AS roas_success,
    SAFE_DIVIDE(SUM(cod), ANY_VALUE(total_spend)) AS roas_total,
    SAFE_DIVIDE(ANY_VALUE(total_spend), COUNT(DISTINCT order_id)) AS cost_per_order,
    SAFE_DIVIDE(ANY_VALUE(total_spend), COUNTIF(status_group = 'success')) AS cost_per_success_order
  FROM all_matched
  GROUP BY ads_id, ad_name, campaign_id, adset_id, ad_page_id,
           shop_id, order_page_name, marketer, ads_source
)

SELECT
  ads_id,
  ad_name,
  campaign_id,
  adset_id,
  ad_page_id,
  shop_id,
  order_page_name,
  marketer,
  ads_source,
  match_type,
  total_orders,
  success_orders,
  returned_orders,
  cancelled_orders,
  total_cod,
  success_cod,
  total_shipping_revenue,
  total_carrier_cost,
  total_spend,
  total_impressions,
  total_reach,
  roas_success,
  roas_total,
  cost_per_order,
  cost_per_success_order,
  first_order_date,
  last_order_date,
  ad_first_date,
  ad_last_date,
  SAFE_DIVIDE(success_orders, total_orders) AS success_rate,
  SAFE_DIVIDE(returned_orders, total_orders) AS return_rate,
  success_cod - COALESCE(total_spend, 0) - COALESCE(total_carrier_cost, 0) AS estimated_profit
FROM matched
