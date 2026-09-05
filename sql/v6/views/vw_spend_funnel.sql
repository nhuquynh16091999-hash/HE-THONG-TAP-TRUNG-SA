-- ═══════════════════════════════════════════════════════════════════
-- FAOS v6 — vw_spend_funnel (Full Funnel Analysis)
-- ═══════════════════════════════════════════════════════════════════
-- Purpose: Full marketing funnel breakdown per campaign.
--          Identifies bottleneck stage where conversion drops most.
--
-- Funnel stages:
--   Impressions → Clicks → Leads → Orders → Delivered
--   (CTR%)       (Lead%)  (Conv%) (Success%)
--
-- ▸ KEY RULE: High return_rate KILLS despite good CPL.
--   An ad can have great top-funnel but terrible post-delivery.
--
-- Source: fact_ads_optimization (aggregated to campaign level, last 7 days)
-- Dataset: Replace {DATASET} with STRAMARK_Dataset / etc.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW `levelup-465304.{DATASET}.vw_spend_funnel` AS
WITH campaign_funnel AS (
    SELECT
        campaign_id,
        MAX(campaign_name)                              AS campaign_name,
        MAX(targeting_country)                          AS targeting_country,
        ANY_VALUE(creative_type)                        AS dominant_creative_type,
        MAX(project_id)                                 AS project_id,

        -- ═══ FUNNEL VOLUME (sum last 7 days) ═══
        SUM(impressions)                                AS impressions,
        SUM(clicks)                                     AS clicks,
        SUM(leads)                                      AS leads,
        SUM(real_orders)                                AS orders,
        SUM(confirmed_orders)                           AS delivered,
        SUM(return_orders)                              AS returned,

        -- ═══ SPEND & REVENUE ═══
        SUM(spend)                                      AS total_spend,
        SUM(real_revenue)                               AS total_real_revenue,
        SUM(confirmed_revenue)                          AS total_confirmed_revenue

    FROM `levelup-465304.{DATASET}.fact_ads_optimization`
    WHERE report_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
      AND campaign_status = 'ACTIVE'
    GROUP BY campaign_id
),
benchmarks AS (
    -- Project-level funnel benchmarks
    SELECT
        project_id,
        SAFE_DIVIDE(SUM(clicks), NULLIF(SUM(impressions), 0))       AS bench_ctr,
        SAFE_DIVIDE(SUM(leads), NULLIF(SUM(clicks), 0))             AS bench_click_to_lead,
        SAFE_DIVIDE(SUM(orders), NULLIF(SUM(leads), 0))             AS bench_lead_to_order,
        SAFE_DIVIDE(SUM(delivered), NULLIF(SUM(orders), 0))         AS bench_order_to_deliver
    FROM campaign_funnel
    GROUP BY project_id
)
SELECT
    f.campaign_id,
    f.campaign_name,
    f.targeting_country,
    f.dominant_creative_type,
    f.project_id,

    -- ═══ FUNNEL VOLUMES ═══
    f.impressions,
    f.clicks,
    f.leads,
    f.orders,
    f.delivered,
    f.returned,
    f.total_spend,
    f.total_confirmed_revenue,

    -- ═══ FUNNEL CONVERSION RATES ═══
    ROUND(SAFE_DIVIDE(f.clicks, NULLIF(f.impressions, 0)), 4)       AS stage1_ctr,
    ROUND(SAFE_DIVIDE(f.leads, NULLIF(f.clicks, 0)), 4)             AS stage2_click_to_lead,
    ROUND(SAFE_DIVIDE(f.orders, NULLIF(f.leads, 0)), 4)             AS stage3_lead_to_order,
    ROUND(SAFE_DIVIDE(f.delivered, NULLIF(f.orders, 0)), 4)         AS stage4_order_to_deliver,
    ROUND(SAFE_DIVIDE(f.returned, NULLIF(f.orders, 0)), 4)          AS return_rate,

    -- ═══ COST PER STAGE ═══
    ROUND(SAFE_DIVIDE(f.total_spend, NULLIF(f.clicks, 0)), 2)       AS cost_per_click,
    ROUND(SAFE_DIVIDE(f.total_spend, NULLIF(f.leads, 0)), 2)        AS cost_per_lead,
    ROUND(SAFE_DIVIDE(f.total_spend, NULLIF(f.orders, 0)), 2)       AS cost_per_order,
    ROUND(SAFE_DIVIDE(f.total_spend, NULLIF(f.delivered, 0)), 2)    AS cost_per_delivered,

    -- ═══ EFFICIENCY ═══
    ROUND(SAFE_DIVIDE(f.total_confirmed_revenue, NULLIF(f.total_spend, 0)), 2)
                                                                     AS confirmed_roas_7d,

    -- ═══ BOTTLENECK DETECTION ═══
    -- Find which stage has the WORST conversion relative to benchmark
    CASE
        WHEN SAFE_DIVIDE(f.clicks, NULLIF(f.impressions, 0))
             < b.bench_ctr * 0.5
             THEN 'IMPRESSION_TO_CLICK'     -- Creative problem
        WHEN SAFE_DIVIDE(f.leads, NULLIF(f.clicks, 0))
             < b.bench_click_to_lead * 0.5
             THEN 'CLICK_TO_LEAD'           -- Landing page or targeting problem
        WHEN SAFE_DIVIDE(f.orders, NULLIF(f.leads, 0))
             < b.bench_lead_to_order * 0.5
             THEN 'LEAD_TO_ORDER'           -- Price, offer, or closing problem
        WHEN SAFE_DIVIDE(f.delivered, NULLIF(f.orders, 0))
             < b.bench_order_to_deliver * 0.8
             THEN 'ORDER_TO_DELIVER'        -- Logistics or COD rejection problem
        WHEN SAFE_DIVIDE(f.returned, NULLIF(f.orders, 0)) > 0.30
             THEN 'HIGH_RETURNS'            -- Product quality or expectation mismatch
        ELSE 'NO_BOTTLENECK'
    END AS bottleneck_stage,

    -- ═══ VS BENCHMARK ═══
    ROUND(SAFE_DIVIDE(f.clicks, NULLIF(f.impressions, 0)) - b.bench_ctr, 4)
                                                                     AS vs_bench_ctr,
    ROUND(SAFE_DIVIDE(f.leads, NULLIF(f.clicks, 0)) - b.bench_click_to_lead, 4)
                                                                     AS vs_bench_click_to_lead,
    ROUND(SAFE_DIVIDE(f.orders, NULLIF(f.leads, 0)) - b.bench_lead_to_order, 4)
                                                                     AS vs_bench_lead_to_order,
    ROUND(SAFE_DIVIDE(f.delivered, NULLIF(f.orders, 0)) - b.bench_order_to_deliver, 4)
                                                                     AS vs_bench_deliver

FROM campaign_funnel f
LEFT JOIN benchmarks b ON f.project_id = b.project_id
WHERE f.total_spend > 0;
