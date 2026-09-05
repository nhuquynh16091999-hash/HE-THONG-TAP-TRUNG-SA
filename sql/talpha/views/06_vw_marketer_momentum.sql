-- ═══════════════════════════════════════════════════════════════════
-- TALPHA Analytics — 06 · vw_marketer_momentum  (LỚP 2: INTELLIGENCE)
-- ═══════════════════════════════════════════════════════════════════
-- "Bảng Phong Thần" — xếp hạng marketer theo ngày.
--   💰 KEO_SO  : confirmed_roas_ma7 ≥ roas_target
--   📊 ON_DINH : roas_danger – roas_target
--   🔥 DOT_TIEN: < roas_danger
-- efficiency_score = confirmed_roas × tỷ lệ giao thành công
-- (không thưởng ROAS ảo khi đơn bị huỷ/hoàn nhiều).
--
-- ▸ G2 — ngưỡng lấy từ config/talpha_rules.json → `thresholds`, không gõ tay.
--
-- ▸ G2 — view kế thừa `marketer_group` và `spend_owner_confidence` từ
--   vw_fact_daily_marketer (qua d.*). TRƯỚC KHI XẾP HẠNG phải lọc
--   `marketer_group != 'external'`, nếu không người ngoài team chạy chung
--   TKQC sẽ đứng trong Bảng Phong Thần của team (X10). View cố tình KHÔNG tự
--   lọc để vẫn đối soát được tổng chi tiêu — trách nhiệm lọc thuộc tab.
--
-- Nguồn: vw_fact_daily_marketer
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW `{PROJECT}.{DATASET}.vw_marketer_momentum` AS
WITH d AS (
    SELECT * FROM `{PROJECT}.{DATASET}.vw_fact_daily_marketer`
)
SELECT
    d.*,

    -- ═══ MOVING AVERAGES (PARTITION theo marketer) ═══
    ROUND(AVG(confirmed_roas) OVER w3, 2)                  AS confirmed_roas_ma3,
    ROUND(AVG(confirmed_roas) OVER w7, 2)                  AS confirmed_roas_ma7,
    ROUND(AVG(provisional_roas) OVER w7, 2)              AS provisional_roas_ma7,
    ROUND(AVG(ads_spend) OVER w7, 0)                     AS spend_ma7,
    ROUND(AVG(success_orders) OVER w7, 1)               AS orders_ma7,

    -- ═══ MOMENTUM ═══
    CASE
        WHEN AVG(confirmed_roas) OVER w3 > AVG(confirmed_roas) OVER w7        THEN 'UPTREND'
        WHEN AVG(confirmed_roas) OVER w3 < AVG(confirmed_roas) OVER w7 * {TH_MOMENTUM_DOWN_RATIO} THEN 'DOWNTREND'
        ELSE 'STABLE'
    END                                                   AS confirmed_roas_momentum,

    -- ═══ VERDICT — Bảng Phong Thần ═══
    CASE
        WHEN AVG(confirmed_roas) OVER w7 >= {TH_ROAS_TARGET} THEN 'KEO_SO'
        WHEN AVG(confirmed_roas) OVER w7 >= {TH_ROAS_DANGER} THEN 'ON_DINH'
        ELSE 'DOT_TIEN'
    END                                                   AS verdict,

    -- ═══ EFFICIENCY SCORE (rank marketers) ═══
    ROUND(
        AVG(confirmed_roas) OVER w7 *
        SAFE_DIVIDE(AVG(success_orders) OVER w7, NULLIF(AVG(total_orders) OVER w7, 0))
    , 2)                                                  AS efficiency_score,

    -- ═══ PHANTOM REVENUE WARNING ═══
    CASE
        WHEN AVG(provisional_roas) OVER w7 > AVG(confirmed_roas) OVER w7 * {TH_PHANTOM_REVENUE_RATIO} THEN TRUE
        ELSE FALSE
    END                                                   AS phantom_revenue_warning

FROM d
WINDOW
    w3 AS (PARTITION BY marketer_name ORDER BY report_date ROWS BETWEEN 2 PRECEDING AND CURRENT ROW),
    w7 AS (PARTITION BY marketer_name ORDER BY report_date ROWS BETWEEN 6 PRECEDING AND CURRENT ROW);
