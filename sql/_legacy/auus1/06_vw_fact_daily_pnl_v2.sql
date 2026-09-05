-- ═══════════════════════════════════════════════════
-- vw_fact_daily_pnl_v2 v3 — AUUS1
-- Source of Truth: sql/auus1/06_vw_fact_daily_pnl_v2.sql
-- ═══════════════════════════════════════════════════
-- Uses FULL ads spend from vw_fact_ads_performance (not just attributed)
-- Revenue from mart_performance_master (order-based)
-- ═══════════════════════════════════════════════════

CREATE OR REPLACE VIEW `levelup-465304.AUUS1_Dataset.vw_fact_daily_pnl_v2` AS
WITH
-- Order metrics from mart (revenue, orders, cogs)
daily_orders AS (
    SELECT report_date,
        SUM(total_orders) AS total_orders,
        SUM(success_orders) AS success_orders,
        SUM(returned_orders) AS returned_orders,
        SUM(cancelled_orders) AS cancelled_orders,
        SUM(pending_orders) AS pending_orders,
        ROUND(SUM(revenue_lead), 0) AS revenue_lead,
        ROUND(SUM(revenue_shipped), 0) AS revenue_shipped,
        ROUND(SUM(revenue_success), 0) AS revenue_success,
        ROUND(SUM(delivered_revenue), 0) AS delivered_revenue,
        ROUND(SUM(revenue_collected), 0) AS revenue_collected,
        ROUND(SUM(cogs), 0) AS cogs
    FROM `levelup-465304.AUUS1_Dataset.mart_performance_master`
    GROUP BY 1
),
-- FULL ads spend from vw_fact_ads_performance (ALL Facebook spend, not just attributed)
daily_ads AS (
    SELECT report_date,
        ROUND(SUM(spend_ron), 0) AS ads_spend,       -- VND (named spend_ron for compat)
        SUM(impressions) AS impressions,
        SUM(clicks) AS clicks,
        SUM(reach) AS reach,
        SUM(messages) AS messages
    FROM `levelup-465304.AUUS1_Dataset.vw_fact_ads_performance`
    GROUP BY 1
)

SELECT
    COALESCE(o.report_date, a.report_date) AS report_date,
    COALESCE(o.total_orders, 0) AS total_orders,
    COALESCE(o.success_orders, 0) AS success_orders,
    COALESCE(o.returned_orders, 0) AS returned_orders,
    COALESCE(o.cancelled_orders, 0) AS cancelled_orders,
    COALESCE(o.pending_orders, 0) AS pending_orders,
    
    -- Revenue tiers (VND)
    COALESCE(o.revenue_lead, 0) AS revenue_lead,
    COALESCE(o.revenue_shipped, 0) AS revenue_shipped,
    COALESCE(o.revenue_success, 0) AS revenue_success,
    COALESCE(o.delivered_revenue, 0) AS delivered_revenue,
    COALESCE(o.revenue_collected, 0) AS revenue_collected,
    
    -- Estimated L4: 65% of shipped revenue
    ROUND(COALESCE(o.revenue_shipped, 0) * 0.65, 0) AS estimated_L4,
    ROUND(COALESCE(o.revenue_shipped, 0) * 0.65 - COALESCE(a.ads_spend, 0) - COALESCE(o.cogs, 0), 0) AS estimated_net_profit,
    
    -- Ads & costs (VND) — FULL spend from all FB campaigns
    COALESCE(a.ads_spend, 0) AS ads_spend_vnd,
    COALESCE(a.ads_spend, 0) AS ads_spend_ron,
    COALESCE(o.cogs, 0) AS cogs,
    ROUND(COALESCE(o.delivered_revenue, 0) - COALESCE(a.ads_spend, 0) - COALESCE(o.cogs, 0), 0) AS net_profit,
    
    -- Traffic
    COALESCE(a.impressions, 0) AS impressions,
    COALESCE(a.clicks, 0) AS clicks,
    COALESCE(a.reach, 0) AS reach,
    COALESCE(a.messages, 0) AS messages,
    
    -- ROAS metrics
    ROUND(SAFE_DIVIDE(COALESCE(o.revenue_shipped, 0), NULLIF(a.ads_spend, 0)), 2) AS roas_shipped,
    ROUND(SAFE_DIVIDE(COALESCE(o.revenue_success, 0), NULLIF(a.ads_spend, 0)), 2) AS roas_success,
    ROUND(SAFE_DIVIDE(COALESCE(o.revenue_shipped, 0) * 0.65, NULLIF(a.ads_spend, 0)), 2) AS roas_estimated,
    
    -- Other rates
    ROUND(SAFE_DIVIDE(COALESCE(o.returned_orders, 0), NULLIF(COALESCE(o.total_orders, 0), 0)) * 100, 1) AS return_rate_pct,
    ROUND(SAFE_DIVIDE(COALESCE(o.success_orders, 0), NULLIF(COALESCE(o.total_orders, 0), 0)) * 100, 1) AS success_rate_pct,
    ROUND(SAFE_DIVIDE(a.ads_spend, NULLIF(COALESCE(o.total_orders, 0), 0)), 0) AS cpl

FROM daily_orders o
FULL OUTER JOIN daily_ads a ON o.report_date = a.report_date
;
