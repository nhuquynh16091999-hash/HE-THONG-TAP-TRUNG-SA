-- ╔══════════════════════════════════════════════════════════╗
-- ║  vw_fact_ads_performance: Ad metrics + 4-tier ROAS      ║
-- ║  + Kill/Scale flags + marketer/country attribution       ║
-- ╚══════════════════════════════════════════════════════════╝
-- Dual join: ad_id match (inbox) + adset_id fallback (landing page)
-- Filters: marketer, campaign, adset, country, date

CREATE OR REPLACE VIEW `{PROJECT}.{DATASET}.vw_fact_ads_performance` AS

WITH ads_daily AS (
  SELECT
    a.ad_id,
    a.ad_name,
    a.adset_id,
    a.adset_name,
    a.campaign_id,
    a.campaign_name,
    a.account_id,
    a.date AS ad_date,
    a.page_id AS ad_page_id,
    SUM(a.spend) AS spend,
    SUM(a.impressions) AS impressions,
    SUM(a.reach) AS reach,
    SUM(a.clicks) AS clicks
  FROM `{PROJECT}.{DATASET}.fb_ads_data` a
  WHERE a.spend > 0
  GROUP BY 1,2,3,4,5,6,7,8,9
),

-- Orders matched by ad_id (direct inbox match)
orders_by_adid AS (
  SELECT
    o.ad_id AS match_key,
    'ad_id' AS match_type,
    o.order_date,
    o.marketer_name,
    o.market_code,
    o.currency,
    SUM(o.revenue) AS revenue,
    SUM(CASE WHEN o.status_group = 'success' THEN o.revenue ELSE 0 END) AS collected_revenue,
    SUM(CASE WHEN o.status_group IN ('returned','returning') THEN o.revenue ELSE 0 END) AS returned_revenue,
    COUNT(*) AS total_orders,
    COUNTIF(o.status_group = 'success') AS success_orders,
    COUNTIF(o.status_group IN ('returned','returning')) AS returned_orders
  FROM `{PROJECT}.{DATASET}.vw_fact_orders` o
  WHERE o.ad_id IS NOT NULL AND o.ad_id != '' AND o.ads_match_type = 'ad_id'
  GROUP BY 1,2,3,4,5,6
),

-- Orders matched by adset_id (UTM landing page fallback)
orders_by_adsetid AS (
  SELECT
    o.ad_id AS match_key,  -- This is actually adset_id stored in ad_id field for UTM orders
    'adset_id' AS match_type,
    o.order_date,
    o.marketer_name,
    o.market_code,
    o.currency,
    SUM(o.revenue) AS revenue,
    SUM(CASE WHEN o.status_group = 'success' THEN o.revenue ELSE 0 END) AS collected_revenue,
    SUM(CASE WHEN o.status_group IN ('returned','returning') THEN o.revenue ELSE 0 END) AS returned_revenue,
    COUNT(*) AS total_orders,
    COUNTIF(o.status_group = 'success') AS success_orders,
    COUNTIF(o.status_group IN ('returned','returning')) AS returned_orders
  FROM `{PROJECT}.{DATASET}.vw_fact_orders` o
  WHERE o.ad_id IS NOT NULL AND o.ad_id != '' AND o.ads_match_type = 'adset_id'
  GROUP BY 1,2,3,4,5,6
),

-- COGS for orders with ads (via order_items)
cogs_by_adid AS (
  SELECT
    o.ad_id AS match_key,
    DATE(PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%E*S', o.inserted_at)) AS order_date,
    SUM(oi.quantity * oi.avg_imported_price) / COALESCE(sp.currency_divisor, 1) AS cogs
  FROM `{PROJECT}.{DATASET}.sale_order` o
  JOIN `{PROJECT}.{DATASET}.order_items` oi ON o.id = oi.order_id AND o.shop_id = oi.shop_id
  LEFT JOIN `{PROJECT}.Zen8_Dataset.dim_shop_project` sp ON o.shop_id = sp.shop_id
  WHERE o.ad_id IS NOT NULL AND o.ad_id != ''
  GROUP BY 1,2, sp.currency_divisor
)

SELECT
  a.ad_date,
  a.ad_id,
  a.ad_name,
  a.adset_id,
  a.adset_name,
  a.campaign_id,
  a.campaign_name,
  a.account_id,
  a.ad_page_id,
  -- Ad metrics
  a.spend,
  a.impressions,
  a.reach,
  a.clicks,
  -- Computed ad metrics
  SAFE_DIVIDE(a.spend, NULLIF(a.impressions, 0)) * 1000 AS cpm,
  SAFE_DIVIDE(a.spend, NULLIF(a.clicks, 0)) AS cpc,
  SAFE_DIVIDE(a.clicks, NULLIF(a.impressions, 0)) * 100 AS ctr,
  SAFE_DIVIDE(a.impressions, NULLIF(a.reach, 0)) AS frequency,
  -- Order attribution (combined)
  COALESCE(oad.match_type, oas.match_type, 'no_match') AS match_type,
  COALESCE(oad.marketer_name, oas.marketer_name, '') AS marketer_name,
  COALESCE(oad.market_code, oas.market_code, '') AS market_code,
  COALESCE(oad.currency, oas.currency, 'USD') AS currency,
  COALESCE(oad.revenue, oas.revenue, 0) AS revenue,
  COALESCE(oad.collected_revenue, oas.collected_revenue, 0) AS collected_revenue,
  COALESCE(oad.returned_revenue, oas.returned_revenue, 0) AS returned_revenue,
  COALESCE(oad.total_orders, oas.total_orders, 0) AS total_orders,
  COALESCE(oad.success_orders, oas.success_orders, 0) AS success_orders,
  COALESCE(oad.returned_orders, oas.returned_orders, 0) AS returned_orders,
  COALESCE(cg.cogs, 0) AS cogs,
  -- ═══ 4-TIER ROAS ═══
  -- 1. Gross ROAS: Revenue / Spend
  SAFE_DIVIDE(COALESCE(oad.revenue, oas.revenue, 0), NULLIF(a.spend, 0)) AS roas_gross,
  -- 2. Net ROAS: (Revenue - Returns) / Spend
  SAFE_DIVIDE(COALESCE(oad.revenue, oas.revenue, 0) - COALESCE(oad.returned_revenue, oas.returned_revenue, 0), NULLIF(a.spend, 0)) AS roas_net,
  -- 3. Real ROAS: (Revenue - Returns - COGS) / Spend
  SAFE_DIVIDE(
    COALESCE(oad.revenue, oas.revenue, 0) - COALESCE(oad.returned_revenue, oas.returned_revenue, 0) - COALESCE(cg.cogs, 0),
    NULLIF(a.spend, 0)
  ) AS roas_real,
  -- 4. Break-even ROAS: 1 / Gross Margin %
  SAFE_DIVIDE(1.0,
    NULLIF(SAFE_DIVIDE(
      COALESCE(oad.revenue, oas.revenue, 0) - COALESCE(cg.cogs, 0),
      NULLIF(COALESCE(oad.revenue, oas.revenue, 0), 0)
    ), 0)
  ) AS roas_breakeven,
  -- P&L
  COALESCE(oad.revenue, oas.revenue, 0) - COALESCE(cg.cogs, 0) AS gross_profit,
  COALESCE(oad.revenue, oas.revenue, 0) - COALESCE(cg.cogs, 0) - a.spend AS operating_profit,
  -- CPA (Cost per Acquisition)
  SAFE_DIVIDE(a.spend, NULLIF(COALESCE(oad.success_orders, oas.success_orders, 0), 0)) AS cpa,
  -- Revenue per click
  SAFE_DIVIDE(COALESCE(oad.revenue, oas.revenue, 0), NULLIF(a.clicks, 0)) AS revenue_per_click,
  -- Return rate
  SAFE_DIVIDE(COALESCE(oad.returned_orders, oas.returned_orders, 0), NULLIF(COALESCE(oad.total_orders, oas.total_orders, 0), 0)) AS return_rate,
  -- ═══ KILL/SCALE FLAGS ═══
  CASE
    WHEN a.spend > 0 AND COALESCE(oad.total_orders, oas.total_orders, 0) = 0 
      AND a.spend > SAFE_DIVIDE(a.spend, NULLIF(COALESCE(oad.success_orders, oas.success_orders, 0), 0)) * 2
      THEN '❌ KILL: Spend>2xCPA, no sale'
    WHEN SAFE_DIVIDE(a.clicks, NULLIF(a.impressions, 0)) * 100 < 0.5 AND a.impressions > 2000
      THEN '❌ KILL: CTR<0.5% after 2K impr'
    WHEN SAFE_DIVIDE(COALESCE(oad.revenue, oas.revenue, 0), NULLIF(a.spend, 0)) > 2.5
      THEN '✅ SCALE: ROAS>2.5x'
    WHEN SAFE_DIVIDE(a.impressions, NULLIF(a.reach, 0)) > 3
      THEN '♻️ REFRESH: Frequency>3'
    ELSE '⏳ MONITOR'
  END AS kill_scale_flag
FROM ads_daily a
LEFT JOIN orders_by_adid oad ON a.ad_id = oad.match_key AND a.ad_date = oad.order_date
LEFT JOIN orders_by_adsetid oas ON a.adset_id = oas.match_key AND a.ad_date = oas.order_date
LEFT JOIN cogs_by_adid cg ON a.ad_id = cg.match_key AND a.ad_date = cg.order_date
;
