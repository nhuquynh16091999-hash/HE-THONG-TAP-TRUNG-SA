-- ═══════════════════════════════════════════════════════════════════
-- TALPHA Analytics — 08 · vw_creative_fatigue  (LỚP 2: INTELLIGENCE)
-- ═══════════════════════════════════════════════════════════════════
-- Gắn cờ quảng cáo "chai" theo 3 dấu hiệu:
--   1. DEAD_CREATIVE     : ≥2000 impression mà CTR < 0.5%   → KILL_AD
--   2. AUDIENCE_SATURATED: frequency (= impr/reach) > 2.5    → REFRESH_CREATIVE
--   3. WEARING_OUT       : CTR 3 ngày < 70% CTR 7 ngày       → MONITOR_CLOSELY
--
-- ▸ TALPHA fb_ads_data KHÔNG có cột frequency → suy impr/reach.
-- ▸ Dùng ctr_calc (clicks/impr, fraction) để tránh lệch đơn vị % của Meta.
--
-- ▸ G2 — ngưỡng lấy từ config/talpha_rules.json → `thresholds`. Đặc biệt
--   `frequency_saturated` TRƯỚC ĐÂY được gõ 2.5 ở CẢ view này lẫn
--   05_vw_daily_momentum: hai view cùng nói "cháy tệp" nhưng ai sửa một bên
--   thì bên kia lệch âm thầm. Nay một nguồn.
--
-- ▸ G2 — `is_test_campaign` là cờ (không lọc): quảng cáo trong campaign test
--   vẫn bị chấm chai, nhưng danh sách "cần thay creative" gửi cho team thì
--   phải loại chúng ra.
--
-- Nguồn: vw_fb_ads_std (30 ngày gần nhất)
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW `{PROJECT}.{DATASET}.vw_creative_fatigue` AS
WITH ad_stats AS (
    SELECT
        ad_id, ad_name, adset_id, adset_name, campaign_id, campaign_name,
        LOGICAL_OR(is_test_campaign)    AS is_test_campaign,
        COUNT(DISTINCT date)            AS active_days,
        SUM(impressions)                AS total_impressions,
        SUM(reach)                      AS total_reach,
        SUM(clicks)                     AS total_clicks,
        SUM(spend)                      AS total_spend,
        -- frequency suy ra = tổng impr / tổng reach
        SAFE_DIVIDE(SUM(impressions), NULLIF(SUM(reach), 0)) AS avg_frequency,
        -- CTR tổng (fraction)
        SAFE_DIVIDE(SUM(clicks), NULLIF(SUM(impressions), 0)) AS avg_ctr,
        -- CTR 3 ngày / 7 ngày gần nhất (fraction)
        SAFE_DIVIDE(
            SUM(IF(date >= DATE_SUB(CURRENT_DATE(), INTERVAL 3 DAY), clicks, 0)),
            NULLIF(SUM(IF(date >= DATE_SUB(CURRENT_DATE(), INTERVAL 3 DAY), impressions, 0)), 0)
        ) AS ctr_last3d,
        SAFE_DIVIDE(
            SUM(IF(date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY), clicks, 0)),
            NULLIF(SUM(IF(date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY), impressions, 0)), 0)
        ) AS ctr_last7d,
        MAX(date)                       AS last_active_date
    FROM `{PROJECT}.{DATASET}.vw_fb_ads_std`
    WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
      AND impressions > 0
    GROUP BY ad_id, ad_name, adset_id, adset_name, campaign_id, campaign_name
)
SELECT
    *,
    CASE
        WHEN total_impressions >= {TH_IMPRESSIONS_MIN_DEAD} AND avg_ctr < {TH_CTR_DEAD_FRAC} THEN 'DEAD_CREATIVE'
        WHEN avg_frequency > {TH_FREQUENCY_SATURATED}                            THEN 'AUDIENCE_SATURATED'
        WHEN ctr_last3d < ctr_last7d * {TH_CTR_WEAROUT_RATIO} AND total_impressions >= {TH_IMPRESSIONS_MIN_WEAROUT} THEN 'WEARING_OUT'
        ELSE 'HEALTHY'
    END AS fatigue_status,
    CASE
        WHEN total_impressions >= {TH_IMPRESSIONS_MIN_DEAD} AND avg_ctr < {TH_CTR_DEAD_FRAC} THEN 5
        WHEN avg_frequency > {TH_FREQUENCY_CRITICAL}                            THEN 4
        WHEN avg_frequency > {TH_FREQUENCY_SATURATED}                            THEN 3
        WHEN ctr_last3d < ctr_last7d * {TH_CTR_WEAROUT_RATIO} AND total_impressions >= {TH_IMPRESSIONS_MIN_WEAROUT} THEN 2
        ELSE 1
    END AS fatigue_severity,
    CASE
        WHEN total_impressions >= {TH_IMPRESSIONS_MIN_DEAD} AND avg_ctr < {TH_CTR_DEAD_FRAC} THEN 'KILL_AD'
        WHEN avg_frequency > {TH_FREQUENCY_SATURATED}                            THEN 'REFRESH_CREATIVE'
        WHEN ctr_last3d < ctr_last7d * {TH_CTR_WEAROUT_RATIO} AND total_impressions >= {TH_IMPRESSIONS_MIN_WEAROUT} THEN 'MONITOR_CLOSELY'
        ELSE 'NO_ACTION'
    END AS recommended_action
FROM ad_stats
WHERE (total_impressions >= {TH_IMPRESSIONS_MIN_DEAD} AND avg_ctr < {TH_CTR_DEAD_FRAC})
   OR avg_frequency > {TH_FREQUENCY_SATURATED}
   OR (ctr_last3d < ctr_last7d * {TH_CTR_WEAROUT_RATIO} AND total_impressions >= {TH_IMPRESSIONS_MIN_WEAROUT})
ORDER BY fatigue_severity DESC, total_spend DESC;
