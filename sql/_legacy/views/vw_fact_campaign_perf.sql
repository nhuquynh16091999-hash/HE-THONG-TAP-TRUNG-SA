-- ╔══════════════════════════════════════════════════════════╗
-- ║  vw_fact_campaign_perf: Campaign-level Kill/Scale        ║
-- ║  Aggregated ROAS + decision signals per campaign         ║
-- ╚══════════════════════════════════════════════════════════╝

CREATE OR REPLACE VIEW `{PROJECT}.{DATASET}.vw_fact_campaign_perf` AS

SELECT
  a.campaign_id,
  a.campaign_name,
  a.ad_date,
  a.account_id,
  -- Aggregated ad metrics
  COUNT(DISTINCT a.ad_id) AS active_ads,
  SUM(a.spend) AS total_spend,
  SUM(a.impressions) AS total_impressions,
  SUM(a.reach) AS total_reach,
  SUM(a.clicks) AS total_clicks,
  -- Aggregated from orders
  SUM(a.revenue) AS total_revenue,
  SUM(a.collected_revenue) AS total_collected,
  SUM(a.total_orders) AS total_orders,
  SUM(a.success_orders) AS total_success,
  SUM(a.returned_orders) AS total_returned,
  SUM(a.cogs) AS total_cogs,
  -- Campaign-level metrics
  SAFE_DIVIDE(SUM(a.spend), NULLIF(SUM(a.impressions), 0)) * 1000 AS campaign_cpm,
  SAFE_DIVIDE(SUM(a.spend), NULLIF(SUM(a.clicks), 0)) AS campaign_cpc,
  SAFE_DIVIDE(SUM(a.clicks), NULLIF(SUM(a.impressions), 0)) * 100 AS campaign_ctr,
  SAFE_DIVIDE(SUM(a.impressions), NULLIF(SUM(a.reach), 0)) AS campaign_frequency,
  -- Campaign 4-tier ROAS
  SAFE_DIVIDE(SUM(a.revenue), NULLIF(SUM(a.spend), 0)) AS campaign_roas_gross,
  SAFE_DIVIDE(SUM(a.revenue) - SUM(a.returned_revenue), NULLIF(SUM(a.spend), 0)) AS campaign_roas_net,
  SAFE_DIVIDE(SUM(a.revenue) - SUM(a.returned_revenue) - SUM(a.cogs), NULLIF(SUM(a.spend), 0)) AS campaign_roas_real,
  -- CPA
  SAFE_DIVIDE(SUM(a.spend), NULLIF(SUM(a.success_orders), 0)) AS campaign_cpa,
  -- Campaign Kill/Scale
  CASE
    WHEN SUM(a.total_orders) = 0 AND SUM(a.spend) > 0
      THEN '❌ KILL: No orders'
    WHEN SAFE_DIVIDE(SUM(a.revenue), NULLIF(SUM(a.spend), 0)) > 2.5
      THEN '✅ SCALE: ROAS>2.5x'
    WHEN SAFE_DIVIDE(SUM(a.revenue), NULLIF(SUM(a.spend), 0)) < 1.0 AND SUM(a.spend) > 0
      THEN '⚠️ UNDERPERFORM: ROAS<1x'
    WHEN SAFE_DIVIDE(SUM(a.impressions), NULLIF(SUM(a.reach), 0)) > 3
      THEN '♻️ FATIGUE: Frequency>3'
    ELSE '⏳ MONITOR'
  END AS campaign_decision,
  -- Return rate
  SAFE_DIVIDE(SUM(a.returned_orders), NULLIF(SUM(a.total_orders), 0)) AS campaign_return_rate,
  -- P&L
  SUM(a.revenue) - SUM(a.cogs) - SUM(a.spend) AS campaign_profit
FROM `{PROJECT}.{DATASET}.vw_fact_ads_performance` a
GROUP BY 1,2,3,4
;
