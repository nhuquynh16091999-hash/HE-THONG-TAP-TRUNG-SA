-- ═══════════════════════════════════════════════════════════════════
-- FAOS v6 — vw_campaign_diagnostic (Win/Fail Scorecard)
-- ═══════════════════════════════════════════════════════════════════
-- Purpose: Per-campaign Win/Fail classification with root-cause
--          attribution. LLM receives THIS scorecard (not raw data).
--
-- Output: campaign_id | status | primary_signal | metrics | vs_avg
-- Status: WIN | OKAY | FAIL | LEARNING
-- Signals (ranked by funnel position):
--   1. WEAK_HOOK     — hook_rate < 15%
--   2. LOW_CTR       — ctr < project_avg × 0.5
--   3. AUDIENCE_SATURATED — frequency > 3 + CPM rising
--   4. CPM_SPIKE     — cpm > cpm_ma7 × 1.3
--   5. LOW_FUNNEL_CONV — lead_to_order < 20%
--   6. PHANTOM_REVENUE — provisional >> confirmed ROAS
--   7. LOW_EFFICIENCY — confirmed_roas < danger threshold
--
-- ▸ RULE: LEARNING campaigns (< 7 days) — observe only, no Kill.
--   Exception: Kill if CTR < 0.2% AND Hook Rate < 5%.
--
-- Source: fact_ads_optimization (aggregated to campaign level)
-- Dataset: Replace {DATASET} with STRAMARK_Dataset / etc.
--
-- Config thresholds (default STRAMARK):
--   ROAS_TARGET = 2.5 | ROAS_DANGER = 1.3 | ROAS_EXCELLENT = 3.0
--   HOOK_RATE_MIN = 0.15 | FREQ_SATURATED = 3.0
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW `levelup-465304.{DATASET}.vw_campaign_diagnostic` AS
WITH campaign_daily AS (
    -- Aggregate ad-level to campaign-level per day
    SELECT
        campaign_id,
        MAX(campaign_name) AS campaign_name,
        MAX(account_id) AS account_id,
        report_date,
        MAX(campaign_age_days) AS campaign_age_days,
        MAX(campaign_status) AS campaign_status,
        MAX(targeting_country) AS targeting_country,

        -- Core metrics (SUM)
        SUM(spend) AS spend,
        SUM(impressions) AS impressions,
        SUM(reach) AS reach,
        SUM(clicks) AS clicks,
        SUM(leads) AS leads,
        SUM(messages) AS messages,
        SUM(add_to_cart) AS add_to_cart,

        -- Video metrics (SUM)
        SUM(video_views) AS video_views,
        SUM(video_views_p25) AS video_views_p25,
        SUM(video_views_p75) AS video_views_p75,
        SUM(video_views_p100) AS video_views_p100,

        -- Revenue metrics (SUM)
        SUM(real_orders) AS real_orders,
        SUM(confirmed_orders) AS confirmed_orders,
        SUM(return_orders) AS return_orders,
        SUM(real_revenue) AS real_revenue,
        SUM(confirmed_revenue) AS confirmed_revenue,

        -- Creative type (MODE — most frequent)
        APPROX_TOP_COUNT(creative_type, 1)[OFFSET(0)].value AS dominant_creative_type,

        MAX(project_id) AS project_id
    FROM `levelup-465304.{DATASET}.fact_ads_optimization`
    WHERE report_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
      AND campaign_status = 'ACTIVE'
    GROUP BY campaign_id, report_date
),
campaign_with_ma AS (
    -- Calculate moving averages + derived metrics
    SELECT
        c.*,

        -- ═══ DERIVED RATES ═══
        SAFE_DIVIDE(clicks, NULLIF(impressions, 0))                     AS ctr_calc,
        SAFE_DIVIDE(spend, NULLIF(impressions, 0)) * 1000               AS cpm_calc,
        SAFE_DIVIDE(spend, NULLIF(clicks, 0))                           AS cpc_calc,
        SAFE_DIVIDE(video_views_p25, NULLIF(impressions, 0))            AS hook_rate,
        SAFE_DIVIDE(video_views_p75, NULLIF(impressions, 0))            AS hold_rate,
        SAFE_DIVIDE(video_views_p100, NULLIF(video_views, 0))           AS completion_rate,
        SAFE_DIVIDE(spend, NULLIF(leads, 0))                            AS cost_per_lead,
        SAFE_DIVIDE(spend, NULLIF(real_orders, 0))                      AS cost_per_order,
        SAFE_DIVIDE(real_revenue, NULLIF(spend, 0))                     AS real_roas,
        SAFE_DIVIDE(confirmed_revenue, NULLIF(spend, 0))                AS confirmed_roas,
        SAFE_DIVIDE(real_orders, NULLIF(leads, 0))                      AS lead_to_order_rate,
        SAFE_DIVIDE(return_orders, NULLIF(real_orders, 0))              AS return_rate,

        -- Frequency
        SAFE_DIVIDE(impressions, NULLIF(reach, 0))                      AS frequency_calc,

        -- ═══ MOVING AVERAGES (7-day) ═══
        ROUND(AVG(SAFE_DIVIDE(confirmed_revenue, NULLIF(spend, 0)))
              OVER w7, 2)                                               AS confirmed_roas_ma7,
        ROUND(AVG(SAFE_DIVIDE(real_revenue, NULLIF(spend, 0)))
              OVER w7, 2)                                               AS real_roas_ma7,
        ROUND(AVG(SAFE_DIVIDE(clicks, NULLIF(impressions, 0)))
              OVER w7, 4)                                               AS ctr_ma7,
        ROUND(AVG(SAFE_DIVIDE(spend, NULLIF(impressions, 0)) * 1000)
              OVER w7, 2)                                               AS cpm_ma7,
        ROUND(AVG(SAFE_DIVIDE(spend, NULLIF(leads, 0)))
              OVER w7, 2)                                               AS cpl_ma7,
        ROUND(AVG(SAFE_DIVIDE(impressions, NULLIF(reach, 0)))
              OVER w7, 2)                                               AS freq_ma7,

        -- ═══ MOVING AVERAGES (3-day) ═══
        ROUND(AVG(SAFE_DIVIDE(confirmed_revenue, NULLIF(spend, 0)))
              OVER w3, 2)                                               AS confirmed_roas_ma3,
        ROUND(AVG(SAFE_DIVIDE(spend, NULLIF(impressions, 0)) * 1000)
              OVER w3, 2)                                               AS cpm_ma3,

        -- ═══ MOMENTUM ═══
        CASE
            WHEN AVG(SAFE_DIVIDE(confirmed_revenue, NULLIF(spend, 0))) OVER w3
                 > AVG(SAFE_DIVIDE(confirmed_revenue, NULLIF(spend, 0))) OVER w7 THEN 'UPTREND'
            WHEN AVG(SAFE_DIVIDE(confirmed_revenue, NULLIF(spend, 0))) OVER w3
                 < AVG(SAFE_DIVIDE(confirmed_revenue, NULLIF(spend, 0))) OVER w7 * 0.95 THEN 'DOWNTREND'
            ELSE 'STABLE'
        END AS roas_momentum

    FROM campaign_daily c
    WINDOW
        w3 AS (PARTITION BY campaign_id ORDER BY report_date ROWS BETWEEN 2 PRECEDING AND CURRENT ROW),
        w7 AS (PARTITION BY campaign_id ORDER BY report_date ROWS BETWEEN 6 PRECEDING AND CURRENT ROW)
),
project_avg AS (
    -- Project-level averages for comparison (last 7 days)
    SELECT
        project_id,
        ROUND(AVG(ctr_calc), 4)                                         AS avg_ctr,
        ROUND(AVG(cpm_calc), 2)                                         AS avg_cpm,
        ROUND(AVG(cost_per_lead), 2)                                    AS avg_cpl,
        ROUND(AVG(CASE WHEN hook_rate > 0 THEN hook_rate END), 4)       AS avg_hook_rate,
        ROUND(AVG(CASE WHEN lead_to_order_rate > 0
                       THEN lead_to_order_rate END), 4)                 AS avg_lead_to_order,
        ROUND(AVG(confirmed_roas), 2)                                   AS avg_confirmed_roas
    FROM campaign_with_ma
    WHERE report_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
    GROUP BY project_id
),
latest AS (
    -- Latest day per campaign
    SELECT cm.*,
           ROW_NUMBER() OVER (PARTITION BY cm.campaign_id ORDER BY cm.report_date DESC) AS rn
    FROM campaign_with_ma cm
)
SELECT
    l.campaign_id,
    l.campaign_name,
    l.account_id,
    l.report_date,
    l.campaign_age_days,
    l.targeting_country,
    l.dominant_creative_type,
    l.project_id,

    -- ═══ TODAY'S METRICS ═══
    l.spend,
    l.impressions,
    l.clicks,
    l.leads,
    l.real_orders,
    l.confirmed_orders,
    l.return_orders,
    l.real_revenue,
    l.confirmed_revenue,

    -- ═══ RATES ═══
    ROUND(l.ctr_calc, 4)         AS ctr,
    ROUND(l.cpm_calc, 2)         AS cpm,
    ROUND(l.hook_rate, 4)        AS hook_rate,
    ROUND(l.hold_rate, 4)        AS hold_rate,
    ROUND(l.cost_per_lead, 2)    AS cost_per_lead,
    ROUND(l.cost_per_order, 2)   AS cost_per_order,
    ROUND(l.frequency_calc, 2)   AS frequency,
    ROUND(l.lead_to_order_rate, 4) AS lead_to_order_rate,
    ROUND(l.return_rate, 4)      AS return_rate,
    ROUND(l.real_roas, 2)        AS real_roas,
    ROUND(l.confirmed_roas, 2)   AS confirmed_roas,

    -- ═══ MOVING AVERAGES ═══
    l.confirmed_roas_ma7,
    l.confirmed_roas_ma3,
    l.real_roas_ma7,
    l.ctr_ma7,
    l.cpm_ma7,
    l.cpl_ma7,
    l.freq_ma7,
    l.roas_momentum,

    -- ═══ CAMPAIGN STATUS CLASSIFICATION ═══
    CASE
        -- LEARNING: < 7 days — observe only
        WHEN l.campaign_age_days < 7 THEN 'LEARNING'
        -- WIN: confirmed ROAS MA7 ≥ target (2.5) + UPTREND
        WHEN l.confirmed_roas_ma7 >= 2.5 AND l.roas_momentum IN ('UPTREND', 'STABLE') THEN 'WIN'
        -- FAIL: confirmed ROAS MA7 < danger (1.3) + DOWNTREND
        WHEN l.confirmed_roas_ma7 < 1.3 AND l.roas_momentum = 'DOWNTREND' THEN 'FAIL'
        -- OKAY: everything in between
        ELSE 'OKAY'
    END AS status,

    -- ═══ PRIMARY ROOT CAUSE SIGNAL (ranked by funnel position) ═══
    CASE
        -- 1. WEAK_HOOK: poor video hook (top-of-funnel)
        WHEN l.hook_rate IS NOT NULL AND l.hook_rate < 0.15 AND l.hook_rate > 0
             THEN 'WEAK_HOOK'
        -- 2. LOW_CTR: creative/copy not engaging
        WHEN l.ctr_calc < pa.avg_ctr * 0.5
             THEN 'LOW_CTR'
        -- 3. AUDIENCE_SATURATED: frequency high + CPM rising
        WHEN l.frequency_calc > 3.0 AND l.cpm_ma3 > l.cpm_ma7 * 1.1
             THEN 'AUDIENCE_SATURATED'
        -- 4. CPM_SPIKE: market dynamics
        WHEN l.cpm_calc > l.cpm_ma7 * 1.3
             THEN 'CPM_SPIKE'
        -- 5. LOW_FUNNEL_CONV: lead → order conversion poor
        WHEN l.lead_to_order_rate IS NOT NULL AND l.lead_to_order_rate < 0.20
             AND l.leads > 5
             THEN 'LOW_FUNNEL_CONV'
        -- 6. PHANTOM_REVENUE: provisional >> confirmed (COD fraud)
        WHEN l.real_roas > 0 AND l.confirmed_roas > 0
             AND l.real_roas > l.confirmed_roas * 1.5
             THEN 'PHANTOM_REVENUE'
        -- 7. LOW_EFFICIENCY: bottom-line fail
        WHEN l.confirmed_roas_ma7 < 1.3
             THEN 'LOW_EFFICIENCY'
        -- No signal: campaign is healthy
        ELSE 'HEALTHY'
    END AS primary_signal,

    -- ═══ VS PROJECT AVERAGE ═══
    ROUND(l.ctr_calc - pa.avg_ctr, 4)                    AS vs_avg_ctr,
    ROUND(l.cpm_calc - pa.avg_cpm, 2)                    AS vs_avg_cpm,
    ROUND(COALESCE(l.cost_per_lead, 0) - COALESCE(pa.avg_cpl, 0), 2)
                                                          AS vs_avg_cpl,
    ROUND(COALESCE(l.hook_rate, 0) - COALESCE(pa.avg_hook_rate, 0), 4)
                                                          AS vs_avg_hook_rate,
    ROUND(COALESCE(l.confirmed_roas, 0) - COALESCE(pa.avg_confirmed_roas, 0), 2)
                                                          AS vs_avg_roas,

    -- ═══ RECOMMENDED ACTION ═══
    CASE
        -- LEARNING exception: catastrophic top-funnel → allow Kill
        WHEN l.campaign_age_days < 7
             AND l.ctr_calc < 0.002 AND COALESCE(l.hook_rate, 1) < 0.05
             THEN 'KILL_EXCEPTION'
        -- LEARNING: no action
        WHEN l.campaign_age_days < 7
             THEN 'OBSERVE'
        -- WIN + enough volume → SCALE candidate
        WHEN l.confirmed_roas_ma7 >= 3.0 AND l.roas_momentum = 'UPTREND'
             AND l.return_rate < 0.30
             THEN 'RECOMMEND_SCALE'
        -- FAIL: DOWNTREND + dangerous ROAS
        WHEN l.confirmed_roas_ma7 < 1.3 AND l.roas_momentum = 'DOWNTREND'
             THEN 'RECOMMEND_KILL'
        -- High return rate despite good CPL
        WHEN l.return_rate > 0.40 AND l.real_roas > 2.0
             THEN 'RECOMMEND_REVIEW_RETURNS'
        -- AUDIENCE_SATURATED
        WHEN l.frequency_calc > 3.5
             THEN 'RECOMMEND_REFRESH_CREATIVE'
        ELSE 'MONITOR'
    END AS recommended_action

FROM latest l
LEFT JOIN project_avg pa ON l.project_id = pa.project_id
WHERE l.rn = 1;
