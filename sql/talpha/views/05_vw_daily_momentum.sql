-- ═══════════════════════════════════════════════════════════════════
-- TALPHA Analytics — 05 · vw_daily_momentum  (LỚP 2: INTELLIGENCE)
-- ═══════════════════════════════════════════════════════════════════
-- MA3/MA7 + tín hiệu xu hướng (UPTREND/DOWNTREND/STABLE) cho các KPI
-- cấp project. confirmed_roas_ma7 là tín hiệu scaling chính.
--
-- ▸ Logic ĐẢO CHIỀU cho chỉ số chi phí (CPA/CPL/CPMess/CPM): tăng = XẤU.
-- ▸ frequency_momentum: vượt `frequency_saturated` (GCC tệp nhỏ) → SATURATED.
-- ▸ phantom_revenue_warning: provisional_roas_ma7 > confirmed × `phantom_revenue_ratio`.
--
-- ▸ G2 — MỌI NGƯỠNG LẤY TỪ config/talpha_rules.json → `thresholds`, KHÔNG gõ
--   số vào file này. Trước G2, ngưỡng frequency 2.5 nằm ở CẢ view này lẫn
--   08_vw_creative_fatigue, và tỷ lệ phantom 1.5 nằm ở CẢ 05, 06 và 07 — sửa
--   một chỗ thì hai chỗ kia lệch đi mà không ai thấy.
--
-- Nguồn: vw_fact_daily_pnl
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW `{PROJECT}.{DATASET}.vw_daily_momentum` AS
WITH d AS (
    SELECT * FROM `{PROJECT}.{DATASET}.vw_fact_daily_pnl`
)
SELECT
    d.*,

    -- ═══ MOVING AVERAGES ═══
    ROUND(AVG(confirmed_revenue) OVER w3, 0)               AS confirmed_revenue_ma3,
    ROUND(AVG(confirmed_revenue) OVER w7, 0)               AS confirmed_revenue_ma7,
    ROUND(AVG(confirmed_roas) OVER w3, 2)                  AS confirmed_roas_ma3,
    ROUND(AVG(confirmed_roas) OVER w7, 2)                  AS confirmed_roas_ma7,
    ROUND(AVG(provisional_roas) OVER w3, 2)               AS provisional_roas_ma3,
    ROUND(AVG(provisional_roas) OVER w7, 2)               AS provisional_roas_ma7,
    ROUND(AVG(total_orders) OVER w3, 1)                   AS orders_ma3,
    ROUND(AVG(total_orders) OVER w7, 1)                   AS orders_ma7,
    ROUND(AVG(ads_spend) OVER w3, 0)                      AS spend_ma3,
    ROUND(AVG(ads_spend) OVER w7, 0)                      AS spend_ma7,
    ROUND(AVG(net_profit) OVER w3, 0)                    AS profit_ma3,
    ROUND(AVG(net_profit) OVER w7, 0)                    AS profit_ma7,
    ROUND(AVG(cost_per_mess) OVER w7, 2)                 AS cpmess_ma7,
    ROUND(AVG(cost_per_lead) OVER w7, 2)                 AS cpl_ma7,
    ROUND(AVG(avg_cpm) OVER w7, 2)                       AS cpm_ma7,
    ROUND(AVG(avg_frequency) OVER w3, 2)                AS freq_ma3,
    ROUND(AVG(avg_frequency) OVER w7, 2)                AS freq_ma7,

    -- ═══ MOMENTUM SIGNALS ═══
    -- Confirmed ROAS (QUAN TRỌNG NHẤT cho scaling)
    CASE
        WHEN AVG(confirmed_roas) OVER w3 > AVG(confirmed_roas) OVER w7        THEN 'UPTREND'
        WHEN AVG(confirmed_roas) OVER w3 < AVG(confirmed_roas) OVER w7 * {TH_MOMENTUM_DOWN_RATIO} THEN 'DOWNTREND'
        ELSE 'STABLE'
    END                                                   AS confirmed_roas_momentum,
    CASE
        WHEN AVG(confirmed_revenue) OVER w3 > AVG(confirmed_revenue) OVER w7        THEN 'UPTREND'
        WHEN AVG(confirmed_revenue) OVER w3 < AVG(confirmed_revenue) OVER w7 * {TH_MOMENTUM_DOWN_RATIO} THEN 'DOWNTREND'
        ELSE 'STABLE'
    END                                                   AS confirmed_revenue_momentum,
    CASE
        WHEN AVG(total_orders) OVER w3 > AVG(total_orders) OVER w7        THEN 'UPTREND'
        WHEN AVG(total_orders) OVER w3 < AVG(total_orders) OVER w7 * {TH_MOMENTUM_DOWN_RATIO} THEN 'DOWNTREND'
        ELSE 'STABLE'
    END                                                   AS orders_momentum,
    CASE
        WHEN AVG(net_profit) OVER w3 > AVG(net_profit) OVER w7        THEN 'UPTREND'
        WHEN AVG(net_profit) OVER w3 < AVG(net_profit) OVER w7 * {TH_MOMENTUM_DOWN_RATIO} THEN 'DOWNTREND'
        ELSE 'STABLE'
    END                                                   AS profit_momentum,

    -- Chi phí: ĐẢO CHIỀU (tăng = xấu)
    CASE
        WHEN AVG(cost_per_mess) OVER w3 > AVG(cost_per_mess) OVER w7 * {TH_MOMENTUM_COST_UP_RATIO} THEN 'UPTREND'
        WHEN AVG(cost_per_mess) OVER w3 < AVG(cost_per_mess) OVER w7        THEN 'DOWNTREND'
        ELSE 'STABLE'
    END                                                   AS cpmess_momentum,
    CASE
        WHEN AVG(avg_cpm) OVER w3 > AVG(avg_cpm) OVER w7 * {TH_MOMENTUM_COST_UP_RATIO} THEN 'UPTREND'
        WHEN AVG(avg_cpm) OVER w3 < AVG(avg_cpm) OVER w7        THEN 'DOWNTREND'
        ELSE 'STABLE'
    END                                                   AS cpm_momentum,

    -- Frequency: > 2.5 = cháy tệp (GCC tệp nhỏ)
    CASE
        WHEN AVG(avg_frequency) OVER w3 > {TH_FREQUENCY_SATURATED}          THEN 'SATURATED'
        WHEN AVG(avg_frequency) OVER w3 > AVG(avg_frequency) OVER w7 * {TH_MOMENTUM_COST_UP_RATIO} THEN 'UPTREND'
        WHEN AVG(avg_frequency) OVER w3 < AVG(avg_frequency) OVER w7        THEN 'DOWNTREND'
        ELSE 'STABLE'
    END                                                   AS frequency_momentum,

    -- ═══ PHANTOM REVENUE WARNING ═══
    CASE
        WHEN AVG(provisional_roas) OVER w7 > AVG(confirmed_roas) OVER w7 * {TH_PHANTOM_REVENUE_RATIO} THEN TRUE
        ELSE FALSE
    END                                                   AS phantom_revenue_warning,

    -- ═══ DAY-OVER-DAY ═══
    ROUND(SAFE_DIVIDE(confirmed_revenue - LAG(confirmed_revenue) OVER wo,
          NULLIF(LAG(confirmed_revenue) OVER wo, 0)) * 100, 1) AS confirmed_revenue_dod_pct,
    ROUND(confirmed_roas - LAG(confirmed_roas) OVER wo, 2)     AS confirmed_roas_dod_change

FROM d
WINDOW
    w3 AS (ORDER BY report_date ROWS BETWEEN 2 PRECEDING AND CURRENT ROW),
    w7 AS (ORDER BY report_date ROWS BETWEEN 6 PRECEDING AND CURRENT ROW),
    wo AS (ORDER BY report_date);
