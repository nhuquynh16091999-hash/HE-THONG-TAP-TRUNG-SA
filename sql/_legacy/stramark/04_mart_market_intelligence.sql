-- ═══════════════════════════════════════════════════
-- mart_market_intelligence v4
-- Source of Truth: sql/stramark/04_mart_market_intelligence.sql
-- DO NOT modify via Python scripts
-- ═══════════════════════════════════════════════════
-- v4 CHANGES (2026-02-16):
--   1. Ads ↔ Marketer/Market join now uses ad_id → vw_fact_orders attribution
--      instead of fragile SPLIT(campaign_name)[OFFSET(5)] for marketer
--      and SPLIT(campaign_name)[OFFSET(2)] for market
-- ═══════════════════════════════════════════════════

CREATE OR REPLACE VIEW `levelup-465304.STRAMARK_Dataset.mart_market_intelligence` AS
WITH fx AS (
    SELECT rate FROM `levelup-465304.STRAMARK_Dataset.cost_exchange_rates`
    WHERE from_currency = 'USD' AND to_currency = 'RON'
    ORDER BY effective_date DESC LIMIT 1
),

-- Build ad_id → (marketer_id, market) from actual order attribution
ad_marketer_map AS (
    SELECT
        resolved_ad_id AS ad_id,
        APPROX_TOP_COUNT(marketer_id, 1)[OFFSET(0)].value AS marketer_id,
        APPROX_TOP_COUNT(derived_market, 1)[OFFSET(0)].value AS market,
        APPROX_TOP_COUNT(derived_market_code, 1)[OFFSET(0)].value AS market_code
    FROM `levelup-465304.STRAMARK_Dataset.vw_fact_orders`
    WHERE resolved_ad_id IS NOT NULL
      AND marketer_id IS NOT NULL
      AND marketer_id != 'UNKNOWN'
    GROUP BY 1
),
adset_marketer_map AS (
    SELECT
        resolved_adset_id AS adset_id,
        APPROX_TOP_COUNT(marketer_id, 1)[OFFSET(0)].value AS marketer_id,
        APPROX_TOP_COUNT(derived_market, 1)[OFFSET(0)].value AS market,
        APPROX_TOP_COUNT(derived_market_code, 1)[OFFSET(0)].value AS market_code
    FROM `levelup-465304.STRAMARK_Dataset.vw_fact_orders`
    WHERE resolved_adset_id IS NOT NULL
      AND marketer_id IS NOT NULL
      AND marketer_id != 'UNKNOWN'
    GROUP BY 1
),

-- Fallback campaign parse
mkter_lookup AS (
    SELECT marketer_id, ANY_VALUE(campaign_code) AS campaign_code
    FROM `levelup-465304.STRAMARK_Dataset.dim_marketer_mapping` GROUP BY marketer_id
),

-- Orders already have derived_market from adset→campaign
order_by_market AS (
    SELECT
        o.order_date AS report_date,
        o.derived_market AS market,
        o.derived_market_code AS market_code,
        o.marketer_id,
        ANY_VALUE(o.marketer_name) AS marketer_name,
        COUNT(DISTINCT o.order_id) AS total_orders,
        COUNTIF(o.status_group = 'success') AS success_orders,
        COUNTIF(o.status_group = 'returned') AS returned_orders,
        COUNTIF(o.status_group = 'cancelled') AS cancelled_orders,
        ROUND(SUM(o.revenue_L1_lead), 2) AS revenue_L1,
        ROUND(SUM(o.revenue_L3_success), 2) AS revenue_L3,
        ROUND(SUM(o.partner_fee), 2) AS shipping_cost
    FROM `levelup-465304.STRAMARK_Dataset.vw_fact_orders` o
    GROUP BY 1, 2, 3, 4
),

-- Ads enriched with 3-level attribution
ads_enriched AS (
    SELECT
        SAFE_CAST(a.date AS DATE) AS report_date,
        -- Market: from order attribution OR campaign parse
        -- Market: from order attribution OR dim_market_mapping only
        -- Do NOT fall back to raw campaign split (avoids targeting types like CĐ, DS)
        COALESCE(
            am.market,
            asm.market,
            mkt.market_name,
            'Unknown'
        ) AS market,
        COALESCE(
            am.market_code,
            asm.market_code,
            mkt.market_code,
            'XX'
        ) AS market_code,
        -- Marketer: from order attribution OR campaign parse
        COALESCE(am.marketer_id, asm.marketer_id, ml.marketer_id, 'UNMATCHED') AS marketer_id,
        a.spend AS ads_spend_usd,
        COALESCE(a.impressions, 0) AS impressions,
        COALESCE(a.clicks, 0) AS clicks,
        COALESCE(a.messaging_conversations_started, 0) AS messages
    FROM `levelup-465304.STRAMARK_Dataset.fb_ads_data` a
    LEFT JOIN ad_marketer_map am ON a.ad_id = am.ad_id
    LEFT JOIN adset_marketer_map asm ON a.adset_id = asm.adset_id
    LEFT JOIN mkter_lookup ml 
        ON UPPER(TRIM(SPLIT(a.campaign_name, ' - ')[SAFE_OFFSET(5)])) = UPPER(TRIM(ml.campaign_code))
    LEFT JOIN `levelup-465304.STRAMARK_Dataset.dim_market_mapping` mkt 
        ON LOWER(TRIM(SPLIT(a.campaign_name, ' - ')[SAFE_OFFSET(2)])) = LOWER(mkt.raw_market)
),
ads_by_market AS (
    SELECT
        report_date, market, market_code, marketer_id,
        SUM(ads_spend_usd) AS ads_spend_usd,
        SUM(impressions) AS impressions,
        SUM(clicks) AS clicks,
        SUM(messages) AS messages
    FROM ads_enriched
    GROUP BY 1, 2, 3, 4
)

SELECT
    COALESCE(om.report_date, am.report_date) AS report_date,
    COALESCE(om.market, am.market, 'Unknown') AS market,
    COALESCE(om.market_code, am.market_code, 'XX') AS market_code,
    COALESCE(om.marketer_id, am.marketer_id, 'UNKNOWN') AS marketer_id,
    COALESCE(om.marketer_name, am.marketer_id) AS marketer_name,
    
    COALESCE(om.total_orders, 0) AS total_orders,
    COALESCE(om.success_orders, 0) AS success_orders,
    COALESCE(om.returned_orders, 0) AS returned_orders,
    COALESCE(om.cancelled_orders, 0) AS cancelled_orders,
    ROUND(COALESCE(om.revenue_L1, 0), 0) AS revenue_lead,
    ROUND(COALESCE(om.revenue_L3, 0), 0) AS revenue_success,
    
    ROUND(COALESCE(am.ads_spend_usd, 0), 2) AS ads_spend_usd,
    ROUND(COALESCE(am.ads_spend_usd, 0) * fx.rate, 0) AS ads_spend_ron,
    COALESCE(am.impressions, 0) AS impressions,
    COALESCE(am.clicks, 0) AS clicks,
    
    ROUND(COALESCE(om.revenue_L3, 0) - COALESCE(am.ads_spend_usd, 0) * fx.rate - COALESCE(om.shipping_cost, 0), 0) AS gross_profit,
    ROUND(SAFE_DIVIDE(om.revenue_L3, NULLIF(am.ads_spend_usd * fx.rate, 0)), 2) AS market_roas,
    ROUND(SAFE_DIVIDE(om.success_orders, NULLIF(om.success_orders + om.returned_orders + om.cancelled_orders, 0)) * 100, 1) AS delivery_rate_pct,
    ROUND(SAFE_DIVIDE(om.returned_orders, NULLIF(om.total_orders, 0)) * 100, 1) AS return_rate_pct,
    ROUND(SAFE_DIVIDE(om.revenue_L1, NULLIF(om.total_orders, 0)), 2) AS market_aov
    
FROM order_by_market om
FULL OUTER JOIN ads_by_market am 
    ON om.report_date = am.report_date 
    AND om.marketer_id = am.marketer_id 
    AND om.market_code = am.market_code
CROSS JOIN fx
;
