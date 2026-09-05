-- ============================================================
-- vw_fact_daily_pnl_flex — Payment-Model-Aware Daily P&L
-- ============================================================
-- Purpose: Same output columns as vw_fact_daily_pnl_v2 but with
--          payment-model awareness for COD vs Prepaid projects.
--
-- COD:     provisional_revenue (all orders) ≠ confirmed_revenue (delivered)
-- Prepaid: provisional_revenue = confirmed_revenue (paid at checkout)
--
-- For datasets WITHOUT mart_performance_master, uses
-- vw_fb_ads_standard + sale_order directly.
-- ============================================================

CREATE OR REPLACE VIEW `levelup-465304.{DATASET}.vw_fact_daily_pnl_flex` AS

WITH daily_orders AS (
    SELECT
        DATE(TIMESTAMP(inserted_at))                        AS report_date,
        COUNT(*)                                            AS total_orders,
        COUNTIF(CAST(status AS STRING) IN ('3','5','6'))     AS success_orders,
        COUNTIF(CAST(status AS STRING) IN ('4','7','8'))     AS returned_orders,
        COUNTIF(CAST(status AS STRING) IN ('9','11','12','13'))  AS cancelled_orders,
        COUNTIF(CAST(status AS STRING) IN ('0','1','2','15','16','17','20'))  AS pending_orders,
        -- Provisional revenue: ALL orders (except cancelled)
        ROUND(SUM(CASE WHEN CAST(status AS STRING) NOT IN ('9','11','12','13')
            THEN COALESCE(CAST(cod AS FLOAT64), 0) / 100.0
            ELSE 0 END), 0)                                 AS revenue_provisional,
        -- Confirmed revenue: only delivered/success
        ROUND(SUM(CASE WHEN CAST(status AS STRING) IN ('3','5','6')
            THEN COALESCE(CAST(cod AS FLOAT64), 0) / 100.0
            ELSE 0 END), 0)                                 AS revenue_confirmed
    FROM `levelup-465304.{DATASET}.sale_order`
    WHERE DATE(TIMESTAMP(inserted_at)) >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
    GROUP BY 1
),

daily_ads AS (
    SELECT
        date                                                AS report_date,
        ROUND(SUM(spend), 2)                                AS ads_spend,
        SUM(impressions)                                    AS impressions,
        SUM(clicks)                                         AS clicks,
        SUM(reach)                                          AS reach,
        SUM(leads)                                          AS total_leads,
        SUM(messaging_conversations_started)                AS total_messages,
        SUM(add_to_cart)                                    AS total_atc,
        SUM(purchases)                                      AS total_purchases
    FROM `levelup-465304.{DATASET}.vw_fb_ads_standard`
    WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
    GROUP BY 1
)

SELECT
    o.report_date,
    COALESCE(o.total_orders, 0)                             AS total_orders,
    COALESCE(o.success_orders, 0)                           AS success_orders,
    COALESCE(o.returned_orders, 0)                          AS returned_orders,
    COALESCE(o.cancelled_orders, 0)                         AS cancelled_orders,
    COALESCE(o.pending_orders, 0)                           AS pending_orders,

    -- Revenue fields (payment-model aware via naming)
    COALESCE(o.revenue_provisional, 0)                      AS revenue_success,
    COALESCE(o.revenue_confirmed, 0)                        AS revenue_confirmed,
    COALESCE(o.revenue_confirmed, 0)                        AS delivered_revenue,

    -- Ads metrics
    COALESCE(a.ads_spend, 0)                                AS ads_spend_ron,
    0.0                                                     AS ads_spend_usd,
    0.0                                                     AS shipping_cost,
    0.0                                                     AS fulfillment_cost,
    0.0                                                     AS return_fulfillment_cost,
    0.0                                                     AS cogs,
    COALESCE(o.revenue_confirmed, 0) - COALESCE(a.ads_spend, 0)
                                                            AS net_profit,

    COALESCE(a.impressions, 0)                              AS impressions,
    COALESCE(a.clicks, 0)                                   AS clicks,
    COALESCE(a.reach, 0)                                    AS reach,
    COALESCE(a.total_messages, 0)                            AS messages,
    COALESCE(a.total_leads, 0)                               AS total_leads,

    -- ROAS (COD-aware)
    ROUND(SAFE_DIVIDE(o.revenue_confirmed, NULLIF(a.ads_spend, 0)), 2)
                                                            AS roas_l3,
    -- Rates
    ROUND(SAFE_DIVIDE(o.returned_orders, NULLIF(o.total_orders, 0)) * 100, 1)
                                                            AS return_rate_pct,
    ROUND(SAFE_DIVIDE(o.success_orders, NULLIF(o.total_orders, 0)) * 100, 1)
                                                            AS success_rate_pct,
    ROUND(SAFE_DIVIDE(a.ads_spend, NULLIF(o.total_orders, 0)), 2)
                                                            AS cpl_ron

FROM daily_orders o
LEFT JOIN daily_ads a ON o.report_date = a.report_date
ORDER BY o.report_date DESC;
