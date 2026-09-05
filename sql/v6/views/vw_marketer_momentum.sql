-- ═══════════════════════════════════════════════════════════════════
-- FAOS v6 — vw_marketer_momentum (COD Business Logic)
-- ═══════════════════════════════════════════════════════════════════
-- Hiệu suất của từng Marketer theo ngày.
-- Tính MA3/MA7 cho Spend, Provisional ROAS, Confirmed ROAS.
-- Momentum signals + Verdict (Kéo Số / Ổn Định / Đốt Tiền).
--
-- Phục vụ: Axis 1 của Analyst — Bảng Phong Thần Marketer
--
-- Source: vw_fact_daily_pnl_marketer (marketer-level daily aggregates)
-- Dataset: Replace {DATASET} with STRAMARK_Dataset / AUUS1_Dataset
--
-- Ref: docs/02_Database_and_API_Specs.md Section 2.2
--      docs/03_AI_Agent_Master_Manual.md (Analyst Axis 1)
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW `levelup-465304.{DATASET}.vw_marketer_momentum` AS
WITH daily_marketer AS (
    SELECT
        report_date,
        marketer_name,

        -- ─── Spend ───
        COALESCE(ads_spend_ron, 0)                                AS spend,

        -- ─── Orders ───
        COALESCE(total_orders, 0)                                 AS total_orders,
        COALESCE(success_orders, 0)                               AS success_orders,

        -- ─── COD: Dual Revenue ───
        COALESCE(revenue_total, 0)                                AS provisional_revenue,
        COALESCE(revenue_confirmed, 0)                            AS confirmed_revenue,

        -- ─── COD: Dual ROAS ───
        SAFE_DIVIDE(COALESCE(revenue_total, 0), NULLIF(ads_spend_ron, 0))
                                                                  AS provisional_roas,
        SAFE_DIVIDE(COALESCE(revenue_confirmed, 0), NULLIF(ads_spend_ron, 0))
                                                                  AS confirmed_roas,

        -- ─── CPA ───
        SAFE_DIVIDE(ads_spend_ron, NULLIF(success_orders, 0))     AS cpa,

        -- ─── Success Rate ───
        SAFE_DIVIDE(success_orders, NULLIF(total_orders, 0)) * 100
                                                                  AS success_rate_pct

    FROM `levelup-465304.{DATASET}.vw_fact_daily_pnl_marketer`
    WHERE report_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
      AND ads_spend_ron > 0
)
SELECT
    d.*,

    -- ═══ MOVING AVERAGES ═══
    -- Confirmed ROAS (dùng cho scaling judgment)
    ROUND(AVG(confirmed_roas) OVER w3, 2)                        AS confirmed_roas_ma3,
    ROUND(AVG(confirmed_roas) OVER w7, 2)                        AS confirmed_roas_ma7,

    -- Provisional ROAS (dùng cho intraday)
    ROUND(AVG(provisional_roas) OVER w3, 2)                      AS provisional_roas_ma3,
    ROUND(AVG(provisional_roas) OVER w7, 2)                      AS provisional_roas_ma7,

    -- Spend
    ROUND(AVG(spend) OVER w3, 0)                                 AS spend_ma3,
    ROUND(AVG(spend) OVER w7, 0)                                 AS spend_ma7,

    -- CPA
    ROUND(AVG(cpa) OVER w3, 0)                                   AS cpa_ma3,
    ROUND(AVG(cpa) OVER w7, 0)                                   AS cpa_ma7,

    -- Orders
    ROUND(AVG(success_orders) OVER w3, 1)                        AS orders_ma3,
    ROUND(AVG(success_orders) OVER w7, 1)                        AS orders_ma7,

    -- ═══ MOMENTUM — Confirmed ROAS ═══
    CASE
        WHEN AVG(confirmed_roas) OVER w3 > AVG(confirmed_roas) OVER w7 THEN 'UPTREND'
        WHEN AVG(confirmed_roas) OVER w3 < AVG(confirmed_roas) OVER w7 * 0.95 THEN 'DOWNTREND'
        ELSE 'STABLE'
    END AS confirmed_roas_momentum,

    -- ═══ MOMENTUM — Spend ═══
    CASE
        WHEN AVG(spend) OVER w3 > AVG(spend) OVER w7 * 1.1 THEN 'UPTREND'
        WHEN AVG(spend) OVER w3 < AVG(spend) OVER w7 * 0.9 THEN 'DOWNTREND'
        ELSE 'STABLE'
    END AS spend_momentum,

    -- ═══ VERDICT — Bảng Phong Thần ═══
    -- 💰 Kéo Số: ROAS > 2.5 (target)
    -- 📊 Ổn Định: ROAS 1.3-2.5
    -- 🔥 Đốt Tiền: ROAS < 1.3 (danger)
    CASE
        WHEN AVG(confirmed_roas) OVER w7 >= 2.5 THEN 'KEO_SO'
        WHEN AVG(confirmed_roas) OVER w7 >= 1.3 THEN 'ON_DINH'
        ELSE 'DOT_TIEN'
    END AS verdict,

    -- ═══ EFFICIENCY SCORE ═══
    -- Dùng để rank marketers: ROAS × (success_orders / total_orders)
    ROUND(
        AVG(confirmed_roas) OVER w7 *
        SAFE_DIVIDE(AVG(success_orders) OVER w7, NULLIF(AVG(total_orders) OVER w7, 0)),
    2) AS efficiency_score,

    -- ═══ PHANTOM REVENUE WARNING ═══
    -- Nếu provisional >> confirmed → đơn ảo cao
    CASE
        WHEN AVG(provisional_roas) OVER w7 > AVG(confirmed_roas) OVER w7 * 1.5 THEN TRUE
        ELSE FALSE
    END AS phantom_revenue_warning

FROM daily_marketer d
WINDOW
    w3 AS (PARTITION BY marketer_name ORDER BY report_date ROWS BETWEEN 2 PRECEDING AND CURRENT ROW),
    w7 AS (PARTITION BY marketer_name ORDER BY report_date ROWS BETWEEN 6 PRECEDING AND CURRENT ROW)
;
