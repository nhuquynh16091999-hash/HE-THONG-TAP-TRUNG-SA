-- ═══════════════════════════════════════════════════════════════════
-- FAOS v6 — vw_daily_momentum (COD Business Logic Update)
-- ═══════════════════════════════════════════════════════════════════
-- Moving Averages (MA3, MA7) cho ROAS, Revenue, Orders, Spend, CPA, Profit
-- + Momentum signals: UPTREND / DOWNTREND / STABLE
-- + Day-over-day changes
--
-- ▸ COD UPDATE:
--   - Tách Provisional Revenue (đơn POS chốt trong ngày, chưa giao)
--     vs Confirmed Revenue (đơn đã giao thành công, trừ hoàn/hủy)
--   - Thêm total_leads, total_messages, cost_per_lead, cost_per_mess
--     (tín hiệu sớm từ Meta — dùng cho intraday optimization)
--   - provisional_roas vs confirmed_roas (MA7 confirmed cho scaling)
--
-- Source: vw_fact_daily_pnl_v2 (project-level daily aggregates)
--         + ads_daily (Meta campaign-level daily metrics)
-- Dataset: Replace {DATASET} with STRAMARK_Dataset / AUUS1_Dataset
--
-- Ref: docs/02_Database_and_API_Specs.md Section 2.1
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW `levelup-465304.{DATASET}.vw_daily_momentum` AS
WITH daily AS (
    SELECT
        p.report_date,
        p.total_orders,
        p.success_orders,
        p.ads_spend_ron,
        p.net_profit,
        p.cpl_ron                                     AS cpa,
        p.return_rate_pct,
        p.success_rate_pct,

        -- ═══ COD: DUAL REVENUE STREAMS ═══
        -- Provisional = tất cả đơn POS chốt trong ngày (bao gồm chưa giao)
        p.revenue_success                             AS provisional_revenue,
        -- Confirmed = chỉ đơn đã DELIVERED/SUCCESS (trừ hoàn hủy)
        COALESCE(p.revenue_confirmed, 0)              AS confirmed_revenue,

        -- ═══ COD: DUAL ROAS ═══
        SAFE_DIVIDE(p.revenue_success, NULLIF(p.ads_spend_ron, 0))
                                                      AS provisional_roas,
        SAFE_DIVIDE(COALESCE(p.revenue_confirmed, 0), NULLIF(p.ads_spend_ron, 0))
                                                      AS confirmed_roas,

        -- Legacy roas column (backward compatibility)
        p.roas_l3                                     AS roas,

        -- ═══ COD: EARLY SIGNAL METRICS (từ Meta Ads) ═══
        COALESCE(a.total_leads, 0)                    AS total_leads,
        COALESCE(a.total_messages, 0)                 AS total_messages,
        COALESCE(a.total_atc, 0)                      AS total_atc,
        COALESCE(a.total_clicks, 0)                   AS total_clicks,
        SAFE_DIVIDE(p.ads_spend_ron, NULLIF(a.total_leads, 0))
                                                      AS cost_per_lead,
        SAFE_DIVIDE(p.ads_spend_ron, NULLIF(a.total_messages, 0))
                                                      AS cost_per_mess,

        -- ═══ ADS EFFICIENCY METRICS (G3 Enhancement) ═══
        COALESCE(a.avg_cpm, 0)                        AS avg_cpm,
        COALESCE(a.avg_ctr, 0)                        AS avg_ctr,
        COALESCE(a.avg_frequency, 0)                  AS avg_frequency,
        COALESCE(a.avg_cpc, 0)                        AS avg_cpc

    FROM `levelup-465304.{DATASET}.vw_fact_daily_pnl_v2` p
    LEFT JOIN (
        -- Aggregate Meta lead/message/ads metrics per day
        SELECT
            CAST(date AS DATE)                            AS report_date,
            SUM(COALESCE(leads, 0))                   AS total_leads,
            SUM(COALESCE(messaging_conversations_started, 0))
                                                      AS total_messages,
            SUM(COALESCE(add_to_cart, 0))              AS total_atc,
            SUM(COALESCE(clicks, 0))                   AS total_clicks,
            ROUND(AVG(NULLIF(cpm, 0)), 2)              AS avg_cpm,
            ROUND(AVG(NULLIF(ctr, 0)), 4)              AS avg_ctr,
            ROUND(AVG(NULLIF(frequency, 0)), 2)        AS avg_frequency,
            ROUND(AVG(NULLIF(cpc, 0)), 2)              AS avg_cpc
        FROM `levelup-465304.{DATASET}.fb_ads_data`
        GROUP BY report_date
    ) a ON p.report_date = a.report_date
    WHERE p.report_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
)
SELECT
    d.*,

    -- ═══ MOVING AVERAGES — CONFIRMED REVENUE (dùng cho scaling decisions) ═══
    ROUND(AVG(confirmed_revenue) OVER w3, 0)           AS confirmed_revenue_ma3,
    ROUND(AVG(confirmed_revenue) OVER w7, 0)           AS confirmed_revenue_ma7,
    ROUND(AVG(confirmed_roas) OVER w3, 2)              AS confirmed_roas_ma3,
    ROUND(AVG(confirmed_roas) OVER w7, 2)              AS confirmed_roas_ma7,

    -- ═══ MOVING AVERAGES — PROVISIONAL (dùng cho intraday monitoring) ═══
    ROUND(AVG(provisional_revenue) OVER w3, 0)         AS provisional_revenue_ma3,
    ROUND(AVG(provisional_revenue) OVER w7, 0)         AS provisional_revenue_ma7,
    ROUND(AVG(provisional_roas) OVER w3, 2)            AS provisional_roas_ma3,
    ROUND(AVG(provisional_roas) OVER w7, 2)            AS provisional_roas_ma7,

    -- ═══ MOVING AVERAGES — ORDERS ═══
    ROUND(AVG(total_orders) OVER w3, 1)                AS orders_ma3,
    ROUND(AVG(total_orders) OVER w7, 1)                AS orders_ma7,

    -- ═══ MOVING AVERAGES — SPEND / CPA / PROFIT ═══
    ROUND(AVG(ads_spend_ron) OVER w3, 0)               AS spend_ma3,
    ROUND(AVG(ads_spend_ron) OVER w7, 0)               AS spend_ma7,
    ROUND(AVG(cpa) OVER w3, 0)                         AS cpa_ma3,
    ROUND(AVG(cpa) OVER w7, 0)                         AS cpa_ma7,
    ROUND(AVG(net_profit) OVER w3, 0)                  AS profit_ma3,
    ROUND(AVG(net_profit) OVER w7, 0)                  AS profit_ma7,

    -- ═══ MOVING AVERAGES — EARLY SIGNALS (CPL, CPMess) ═══
    ROUND(AVG(cost_per_lead) OVER w3, 0)               AS cpl_ma3,
    ROUND(AVG(cost_per_lead) OVER w7, 0)               AS cpl_ma7,
    ROUND(AVG(cost_per_mess) OVER w3, 0)               AS cpmess_ma3,
    ROUND(AVG(cost_per_mess) OVER w7, 0)               AS cpmess_ma7,

    -- ═══ MOVING AVERAGES — ADS EFFICIENCY (G3 Enhancement) ═══
    ROUND(AVG(avg_cpm) OVER w3, 2)                     AS cpm_ma3,
    ROUND(AVG(avg_cpm) OVER w7, 2)                     AS cpm_ma7,
    ROUND(AVG(avg_frequency) OVER w3, 2)               AS freq_ma3,
    ROUND(AVG(avg_frequency) OVER w7, 2)               AS freq_ma7,
    ROUND(AVG(avg_ctr) OVER w7, 4)                     AS ctr_ma7,
    ROUND(AVG(avg_cpc) OVER w7, 2)                     AS cpc_ma7,

    -- ═══ MOMENTUM SIGNALS ═══

    -- Confirmed Revenue momentum (dùng cho scaling quyết định)
    CASE
        WHEN AVG(confirmed_revenue) OVER w3 > AVG(confirmed_revenue) OVER w7 THEN 'UPTREND'
        WHEN AVG(confirmed_revenue) OVER w3 < AVG(confirmed_revenue) OVER w7 * 0.95 THEN 'DOWNTREND'
        ELSE 'STABLE'
    END AS confirmed_revenue_momentum,

    -- Confirmed ROAS momentum (QUAN TRỌNG NHẤT cho scaling)
    CASE
        WHEN AVG(confirmed_roas) OVER w3 > AVG(confirmed_roas) OVER w7 THEN 'UPTREND'
        WHEN AVG(confirmed_roas) OVER w3 < AVG(confirmed_roas) OVER w7 * 0.95 THEN 'DOWNTREND'
        ELSE 'STABLE'
    END AS confirmed_roas_momentum,

    -- Provisional Revenue momentum (dùng cho intraday check)
    CASE
        WHEN AVG(provisional_revenue) OVER w3 > AVG(provisional_revenue) OVER w7 THEN 'UPTREND'
        WHEN AVG(provisional_revenue) OVER w3 < AVG(provisional_revenue) OVER w7 * 0.95 THEN 'DOWNTREND'
        ELSE 'STABLE'
    END AS provisional_revenue_momentum,

    -- Legacy roas_momentum (backward compat)
    CASE
        WHEN AVG(roas) OVER w3 > AVG(roas) OVER w7 THEN 'UPTREND'
        WHEN AVG(roas) OVER w3 < AVG(roas) OVER w7 * 0.95 THEN 'DOWNTREND'
        ELSE 'STABLE'
    END AS roas_momentum,

    CASE
        WHEN AVG(total_orders) OVER w3 > AVG(total_orders) OVER w7 THEN 'UPTREND'
        WHEN AVG(total_orders) OVER w3 < AVG(total_orders) OVER w7 * 0.95 THEN 'DOWNTREND'
        ELSE 'STABLE'
    END AS orders_momentum,

    -- CPA: inverted — CPA tăng = XẤU, CPA giảm = TỐT
    CASE
        WHEN AVG(cpa) OVER w3 > AVG(cpa) OVER w7 * 1.05 THEN 'UPTREND'
        WHEN AVG(cpa) OVER w3 < AVG(cpa) OVER w7 THEN 'DOWNTREND'
        ELSE 'STABLE'
    END AS cpa_momentum,

    CASE
        WHEN AVG(net_profit) OVER w3 > AVG(net_profit) OVER w7 THEN 'UPTREND'
        WHEN AVG(net_profit) OVER w3 < AVG(net_profit) OVER w7 * 0.95 THEN 'DOWNTREND'
        ELSE 'STABLE'
    END AS profit_momentum,

    -- CPL momentum: inverted — CPL tăng = XẤU
    CASE
        WHEN AVG(cost_per_lead) OVER w3 > AVG(cost_per_lead) OVER w7 * 1.1 THEN 'UPTREND'
        WHEN AVG(cost_per_lead) OVER w3 < AVG(cost_per_lead) OVER w7 THEN 'DOWNTREND'
        ELSE 'STABLE'
    END AS cpl_momentum,

    -- CPM momentum: inverted — CPM tăng = XẤU (audience saturation)
    CASE
        WHEN AVG(avg_cpm) OVER w3 > AVG(avg_cpm) OVER w7 * 1.1 THEN 'UPTREND'
        WHEN AVG(avg_cpm) OVER w3 < AVG(avg_cpm) OVER w7 THEN 'DOWNTREND'
        ELSE 'STABLE'
    END AS cpm_momentum,

    -- Frequency momentum: inverted — Frequency tăng = creative fatigue
    CASE
        WHEN AVG(avg_frequency) OVER w3 > 3.0 THEN 'SATURATED'
        WHEN AVG(avg_frequency) OVER w3 > AVG(avg_frequency) OVER w7 * 1.1 THEN 'UPTREND'
        WHEN AVG(avg_frequency) OVER w3 < AVG(avg_frequency) OVER w7 THEN 'DOWNTREND'
        ELSE 'STABLE'
    END AS frequency_momentum,

    -- ═══ FUNNEL CONVERSION RATES (G3 Enhancement) ═══
    SAFE_DIVIDE(total_atc, NULLIF(total_clicks, 0))    AS click_to_atc_rate,
    SAFE_DIVIDE(total_leads, NULLIF(total_atc, 0))     AS atc_to_lead_rate,

    -- ═══ DAY-OVER-DAY CHANGE ═══
    ROUND(
        SAFE_DIVIDE(
            confirmed_revenue - LAG(confirmed_revenue) OVER wo,
            NULLIF(LAG(confirmed_revenue) OVER wo, 0)
        ) * 100, 1
    ) AS confirmed_revenue_dod_pct,

    ROUND(confirmed_roas - LAG(confirmed_roas) OVER wo, 2) AS confirmed_roas_dod_change,

    ROUND(
        SAFE_DIVIDE(
            provisional_revenue - LAG(provisional_revenue) OVER wo,
            NULLIF(LAG(provisional_revenue) OVER wo, 0)
        ) * 100, 1
    ) AS provisional_revenue_dod_pct,

    ROUND(
        SAFE_DIVIDE(
            total_orders - LAG(total_orders) OVER wo,
            NULLIF(LAG(total_orders) OVER wo, 0)
        ) * 100, 1
    ) AS orders_dod_pct

FROM daily d
WINDOW
    w3 AS (ORDER BY report_date ROWS BETWEEN 2 PRECEDING AND CURRENT ROW),
    w7 AS (ORDER BY report_date ROWS BETWEEN 6 PRECEDING AND CURRENT ROW),
    wo AS (ORDER BY report_date)
;
