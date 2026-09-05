-- ═══════════════════════════════════════════════════════════════════
-- FAOS v6 — vw_creative_fatigue (G3 Enhancement)
-- ═══════════════════════════════════════════════════════════════════
-- Flags ads with creative fatigue signals:
--   1. CTR < 0.5% after 2000+ impressions → dead creative
--   2. Frequency > 3 → audience saturation
--   3. CTR declining (MA3 < MA7) → creative wearing out
--
-- Used by: faos_brain/analyst.py (optional query)
-- Does NOT affect: dashboard, existing views, API routes
--
-- Source: fb_ads_data (ad-level daily metrics)
-- Dataset: Replace {DATASET} with STRAMARK_Dataset / AUUS1_Dataset
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW `levelup-465304.{DATASET}.vw_creative_fatigue` AS
WITH ad_stats AS (
    SELECT
        ad_id,
        ad_name,
        adset_id,
        adset_name,
        campaign_id,
        campaign_name,
        COUNT(DISTINCT date) AS active_days,
        SUM(COALESCE(impressions, 0)) AS total_impressions,
        SUM(COALESCE(clicks, 0)) AS total_clicks,
        SUM(COALESCE(spend, 0)) AS total_spend,
        AVG(NULLIF(ctr, 0)) AS avg_ctr,
        AVG(NULLIF(frequency, 0)) AS avg_frequency,
        AVG(NULLIF(cpm, 0)) AS avg_cpm,
        -- Last 3 days CTR
        AVG(CASE WHEN CAST(date AS DATE) >= DATE_SUB(CURRENT_DATE(), INTERVAL 3 DAY) THEN ctr END) AS ctr_last3d,
        -- Last 7 days CTR
        AVG(CASE WHEN CAST(date AS DATE) >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY) THEN ctr END) AS ctr_last7d,
        MAX(date) AS last_active_date
    FROM `levelup-465304.{DATASET}.fb_ads_data`
    WHERE CAST(date AS DATE) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
      AND impressions > 0
    GROUP BY ad_id, ad_name, adset_id, adset_name, campaign_id, campaign_name
)
SELECT
    *,

    -- ═══ FATIGUE SIGNALS ═══
    CASE
        -- Dead creative: low CTR after enough impressions
        WHEN total_impressions >= 2000 AND avg_ctr < 0.005 THEN 'DEAD_CREATIVE'
        -- Audience saturated: frequency too high
        WHEN avg_frequency > 3.0 THEN 'AUDIENCE_SATURATED'
        -- Wearing out: CTR declining
        WHEN ctr_last3d < ctr_last7d * 0.7 AND total_impressions >= 1000 THEN 'WEARING_OUT'
        -- Healthy
        ELSE 'HEALTHY'
    END AS fatigue_status,

    -- Fatigue severity (1-5)
    CASE
        WHEN total_impressions >= 2000 AND avg_ctr < 0.005 THEN 5
        WHEN avg_frequency > 4.0 THEN 4
        WHEN avg_frequency > 3.0 THEN 3
        WHEN ctr_last3d < ctr_last7d * 0.7 AND total_impressions >= 1000 THEN 2
        ELSE 1
    END AS fatigue_severity,

    -- Recommended action
    CASE
        WHEN total_impressions >= 2000 AND avg_ctr < 0.005 THEN 'KILL_AD'
        WHEN avg_frequency > 3.0 THEN 'REFRESH_CREATIVE'
        WHEN ctr_last3d < ctr_last7d * 0.7 AND total_impressions >= 1000 THEN 'MONITOR_CLOSELY'
        ELSE 'NO_ACTION'
    END AS recommended_action

FROM ad_stats
WHERE
    -- Only show problematic ads
    (total_impressions >= 2000 AND avg_ctr < 0.005)
    OR avg_frequency > 3.0
    OR (ctr_last3d < ctr_last7d * 0.7 AND total_impressions >= 1000)
ORDER BY fatigue_severity DESC, total_spend DESC
;
