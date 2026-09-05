-- ═══════════════════════════════════════════════════════════════════
-- FAOS v6 — vw_product_lifecycle (BCG Matrix — COD Business Logic)
-- ═══════════════════════════════════════════════════════════════════
-- Phân loại vòng đời sản phẩm theo BCG Matrix:
--   ⭐ Star     → SCALE (ROAS excellent + UPTREND)
--   🐄 Cash Cow → MAINTAIN (ROAS target + STABLE + mature)
--   ❓ Question → MONITOR (too young or borderline)
--   🐕 Dog      → KILL (ROAS danger + DOWNTREND + mature enough)
--
-- QUAN TRỌNG: Dùng Confirmed Revenue (POS giao thành công)
-- làm chuẩn — KHÔNG dùng Meta reported revenue.
--
-- Phục vụ: Axis 2 của Analyst — Vòng Đời Sản Phẩm
--
-- Source: ads_daily (campaign/product level) + vw_fact_orders (POS)
-- Dataset: Replace {DATASET} with STRAMARK_Dataset / AUUS1_Dataset
--
-- Ref: docs/03_AI_Agent_Master_Manual.md (Analyst Axis 2 — BCG)
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW `levelup-465304.{DATASET}.vw_product_lifecycle` AS
WITH product_daily AS (
    SELECT
        a.report_date,
        a.product_code,
        a.product_name,
        a.campaign_id,
        a.campaign_name,

        -- ─── Spend ───
        COALESCE(SUM(a.spend), 0)                                 AS spend,

        -- ─── COD: Confirmed Revenue (POS thực giao) ───
        COALESCE(SUM(o.confirmed_revenue), 0)                     AS confirmed_revenue,
        COALESCE(SUM(o.provisional_revenue), 0)                   AS provisional_revenue,
        COALESCE(SUM(o.success_orders), 0)                        AS success_orders,
        COALESCE(SUM(o.total_orders), 0)                          AS total_orders,

        -- ─── COD: Dual ROAS ───
        SAFE_DIVIDE(
            COALESCE(SUM(o.confirmed_revenue), 0),
            NULLIF(SUM(a.spend), 0)
        )                                                         AS confirmed_roas,
        SAFE_DIVIDE(
            COALESCE(SUM(o.provisional_revenue), 0),
            NULLIF(SUM(a.spend), 0)
        )                                                         AS provisional_roas

    FROM `levelup-465304.{DATASET}.ads_daily` a
    LEFT JOIN (
        -- Aggregate POS orders per product per day
        SELECT
            order_date                                            AS report_date,
            product_code,
            SUM(CASE WHEN status IN ('DELIVERED', 'SUCCESS') THEN order_value ELSE 0 END)
                                                                  AS confirmed_revenue,
            SUM(order_value)                                      AS provisional_revenue,
            COUNTIF(status IN ('DELIVERED', 'SUCCESS'))            AS success_orders,
            COUNT(*)                                              AS total_orders
        FROM `levelup-465304.{DATASET}.vw_fact_orders`
        WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
        GROUP BY order_date, product_code
    ) o ON a.report_date = o.report_date AND a.product_code = o.product_code
    WHERE a.report_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
      AND a.spend > 0
    GROUP BY a.report_date, a.product_code, a.product_name, a.campaign_id, a.campaign_name
),
product_metrics AS (
    SELECT
        product_code,
        product_name,
        campaign_id,
        campaign_name,

        -- ─── Latest date ───
        MAX(report_date)                                          AS latest_date,
        MIN(report_date)                                          AS first_date,

        -- ─── Age (days with spend) ───
        COUNT(DISTINCT report_date)                               AS days_active,

        -- ─── Aggregates (MA7 equivalent — last 7 active days) ───
        ROUND(AVG(CASE WHEN report_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
              THEN confirmed_roas END), 2)                        AS confirmed_roas_ma7,
        ROUND(AVG(CASE WHEN report_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 3 DAY)
              THEN confirmed_roas END), 2)                        AS confirmed_roas_ma3,
        ROUND(AVG(CASE WHEN report_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
              THEN provisional_roas END), 2)                      AS provisional_roas_ma7,

        -- ─── Totals (7-day) ───
        SUM(CASE WHEN report_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
            THEN spend ELSE 0 END)                                AS spend_7d,
        SUM(CASE WHEN report_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
            THEN confirmed_revenue ELSE 0 END)                    AS confirmed_revenue_7d,
        SUM(CASE WHEN report_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
            THEN success_orders ELSE 0 END)                       AS success_orders_7d,
        SUM(CASE WHEN report_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
            THEN total_orders ELSE 0 END)                         AS total_orders_7d,

        -- ─── Success Rate ───
        SAFE_DIVIDE(
            SUM(CASE WHEN report_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
                THEN success_orders ELSE 0 END),
            NULLIF(SUM(CASE WHEN report_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
                THEN total_orders ELSE 0 END), 0)
        ) * 100                                                   AS success_rate_7d

    FROM product_daily
    GROUP BY product_code, product_name, campaign_id, campaign_name
)
SELECT
    m.*,

    -- ═══ MOMENTUM (MA3 vs MA7) ═══
    CASE
        WHEN confirmed_roas_ma3 > confirmed_roas_ma7 THEN 'UPTREND'
        WHEN confirmed_roas_ma3 < confirmed_roas_ma7 * 0.95 THEN 'DOWNTREND'
        ELSE 'STABLE'
    END AS confirmed_roas_momentum,

    -- ═══ BCG MATRIX CLASSIFICATION ═══
    -- Dựa trên Confirmed ROAS (POS thực giao)
    -- Thresholds: excellent=3.0, target=2.5, danger=1.3
    CASE
        -- ⭐ Star: ROAS excellent + UPTREND
        WHEN confirmed_roas_ma7 >= 3.0
         AND confirmed_roas_ma3 > confirmed_roas_ma7
         AND days_active >= 7
        THEN 'STAR'

        -- 🐄 Cash Cow: ROAS target + STABLE + mature
        WHEN confirmed_roas_ma7 >= 2.5
         AND confirmed_roas_ma3 >= confirmed_roas_ma7 * 0.95
         AND days_active >= 14
        THEN 'CASH_COW'

        -- 🐕 Dog: ROAS danger + DOWNTREND + old enough to judge
        WHEN confirmed_roas_ma7 < 1.3
         AND confirmed_roas_ma3 < confirmed_roas_ma7 * 0.95
         AND days_active >= 5
        THEN 'DOG'

        -- ❓ Question Mark: everything else (young or borderline)
        ELSE 'QUESTION_MARK'
    END AS bcg_stage,

    -- ═══ RECOMMENDED ACTION ═══
    CASE
        WHEN confirmed_roas_ma7 >= 3.0
         AND confirmed_roas_ma3 > confirmed_roas_ma7
         AND days_active >= 7
         AND COALESCE(success_rate_7d, 0) >= 70
        THEN 'SCALE'

        WHEN confirmed_roas_ma7 >= 2.5
         AND days_active >= 14
        THEN 'MAINTAIN'

        WHEN days_active < 7
        THEN 'LEARNING'

        WHEN confirmed_roas_ma7 < 1.3
         AND days_active >= 5
        THEN 'KILL'

        WHEN confirmed_roas_ma7 BETWEEN 1.3 AND 2.5
        THEN 'MONITOR'

        ELSE 'MONITOR'
    END AS recommended_action,

    -- ═══ PHANTOM REVENUE WARNING ═══
    CASE
        WHEN provisional_roas_ma7 > confirmed_roas_ma7 * 1.5 THEN TRUE
        ELSE FALSE
    END AS phantom_revenue_warning,

    -- ═══ SCALE ELIGIBILITY (strict COD rules) ═══
    CASE
        WHEN confirmed_roas_ma7 >= 3.0                            -- Excellent ROAS
         AND confirmed_roas_ma3 > confirmed_roas_ma7              -- UPTREND
         AND days_active >= 7                                      -- Past learning
         AND COALESCE(success_rate_7d, 0) >= 70                   -- COD delivery OK
         AND (provisional_roas_ma7 <= confirmed_roas_ma7 * 1.5    -- No phantom revenue
              OR provisional_roas_ma7 IS NULL)
        THEN TRUE
        ELSE FALSE
    END AS scale_eligible

FROM product_metrics m
WHERE days_active >= 1  -- At least 1 day of data
;
