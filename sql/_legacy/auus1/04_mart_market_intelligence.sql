-- ═══════════════════════════════════════════════════
-- mart_market_intelligence v2 — AUUS1
-- Source of Truth: sql/auus1/04_mart_market_intelligence.sql
-- ═══════════════════════════════════════════════════
-- AUUS1 campaign format: Market/Marketer/Product/AccountID/PageName/Date
-- Markets: AUS, Australia → AU; US → US
-- Revenue and spend are both VND — no fx conversion needed
-- ═══════════════════════════════════════════════════

CREATE OR REPLACE VIEW `levelup-465304.AUUS1_Dataset.mart_market_intelligence` AS
WITH
-- Normalize market helper
-- Orders already have derived_market from shop_id (US/AU)
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
        ROUND(SUM(o.revenue_L1_lead), 0) AS revenue_L1,
        ROUND(SUM(o.revenue_L2_shipped), 0) AS revenue_L2,
        ROUND(SUM(o.revenue_L3_success), 0) AS revenue_L3,
        ROUND(SUM(o.partner_fee), 0) AS shipping_cost
    FROM `levelup-465304.AUUS1_Dataset.vw_fact_orders` o
    GROUP BY 1, 2, 3, 4
),

-- Ads: all campaigns named AUS/*, so allocate proportionally by market order ratio
-- Step 1: Get total daily ads spend per marketer (ignoring campaign_market since all=AU)
ads_total AS (
    SELECT
        report_date,
        campaign_mkter_code AS marketer_short,
        SUM(spend_ron) AS ads_spend_vnd,
        SUM(impressions) AS impressions,
        SUM(clicks) AS clicks,
        SUM(messages) AS messages
    FROM `levelup-465304.AUUS1_Dataset.vw_fact_ads_performance`
    GROUP BY 1, 2
),
-- Step 2: Get daily order proportions per market
market_proportions AS (
    SELECT
        o.order_date AS report_date,
        o.derived_market AS market,
        COUNT(DISTINCT o.order_id) AS market_orders,
        SUM(COUNT(DISTINCT o.order_id)) OVER (PARTITION BY o.order_date) AS total_orders_day
    FROM `levelup-465304.AUUS1_Dataset.vw_fact_orders` o
    GROUP BY 1, 2
),
-- Step 3: Distribute ads spend proportionally to each market
ads_by_market AS (
    SELECT
        adst.report_date,
        mp.market,
        mp.market AS market_code,
        adst.marketer_short,
        ROUND(adst.ads_spend_vnd * SAFE_DIVIDE(mp.market_orders, NULLIF(mp.total_orders_day, 0)), 0) AS ads_spend_vnd,
        ROUND(adst.impressions * SAFE_DIVIDE(mp.market_orders, NULLIF(mp.total_orders_day, 0))) AS impressions,
        ROUND(adst.clicks * SAFE_DIVIDE(mp.market_orders, NULLIF(mp.total_orders_day, 0))) AS clicks,
        ROUND(adst.messages * SAFE_DIVIDE(mp.market_orders, NULLIF(mp.total_orders_day, 0))) AS messages
    FROM ads_total adst
    CROSS JOIN market_proportions mp
    WHERE adst.report_date = mp.report_date
),

-- Resolve marketer short name → marketer_id via dim_marketer_mapping
mkter_resolve AS (
    SELECT DISTINCT
        CASE
            WHEN LOWER(TRIM(raw_name)) IN ('mạnh', 'đặng mạnh', 'đặng sỹ mạnh', 'manhds') THEN 'MANHDS'
            WHEN LOWER(TRIM(raw_name)) IN ('thành', 'tất thành', 'nguyễn tất thành', 'thanhnt') THEN 'THANHNT'
            WHEN LOWER(TRIM(raw_name)) IN ('thắng', 'hữu thắng', 'nguyễn hữu thắng', 'thangnh') THEN 'THANGNH'
            WHEN LOWER(TRIM(raw_name)) IN ('kính', 'bùi nguyên kính', 'kinhbn') THEN 'KINHBN'
            WHEN LOWER(TRIM(raw_name)) IN ('chính', 'chinhtv', 'chính tv', 'chinh tv') THEN 'CHINHTV'
            ELSE UPPER(TRIM(raw_name))
        END AS marketer_id,
        raw_name
    FROM `levelup-465304.AUUS1_Dataset.dim_marketer_mapping`
)

SELECT
    COALESCE(om.report_date, am.report_date) AS report_date,
    COALESCE(om.market, am.market, 'Unknown') AS market,
    COALESCE(om.market_code, am.market_code, 'XX') AS market_code,
    COALESCE(om.marketer_id, 
        CASE
            WHEN LOWER(TRIM(am.marketer_short)) IN ('mạnh') THEN 'MANHDS'
            WHEN LOWER(TRIM(am.marketer_short)) IN ('thành') THEN 'THANHNT'
            WHEN LOWER(TRIM(am.marketer_short)) IN ('thắng') THEN 'THANGNH'
            WHEN LOWER(TRIM(am.marketer_short)) IN ('kính') THEN 'KINHBN'
            WHEN LOWER(TRIM(am.marketer_short)) IN ('chính', 'chinhtv') THEN 'CHINHTV'
            ELSE 'UNMATCHED'
        END
    ) AS marketer_id,
    COALESCE(om.marketer_name,
        CASE
            WHEN LOWER(TRIM(am.marketer_short)) IN ('mạnh') THEN 'Đặng Sỹ Mạnh'
            WHEN LOWER(TRIM(am.marketer_short)) IN ('thành') THEN 'Nguyễn Tất Thành'
            WHEN LOWER(TRIM(am.marketer_short)) IN ('thắng') THEN 'Nguyễn Hữu Thắng'
            WHEN LOWER(TRIM(am.marketer_short)) IN ('kính') THEN 'Bùi Nguyên Kính'
            WHEN LOWER(TRIM(am.marketer_short)) IN ('chính', 'chinhtv') THEN 'Chính TV'
            ELSE am.marketer_short
        END
    ) AS marketer_name,
    
    COALESCE(om.total_orders, 0) AS total_orders,
    COALESCE(om.success_orders, 0) AS success_orders,
    COALESCE(om.returned_orders, 0) AS returned_orders,
    COALESCE(om.cancelled_orders, 0) AS cancelled_orders,
    ROUND(COALESCE(om.revenue_L1, 0), 0) AS revenue_lead,
    ROUND(COALESCE(om.revenue_L2, 0), 0) AS revenue_shipped,
    ROUND(COALESCE(om.revenue_L3, 0), 0) AS revenue_success,
    ROUND(COALESCE(om.revenue_L3, 0), 0) AS delivered_revenue,
    COALESCE(om.total_orders, 0) AS order_count,
    
    ROUND(COALESCE(am.ads_spend_vnd, 0), 0) AS ads_spend_vnd,
    ROUND(COALESCE(am.ads_spend_vnd, 0), 0) AS ads_spend_ron,
    COALESCE(am.impressions, 0) AS impressions,
    COALESCE(am.clicks, 0) AS clicks,
    
    ROUND(COALESCE(om.revenue_L3, 0) - COALESCE(am.ads_spend_vnd, 0) - COALESCE(om.shipping_cost, 0), 0) AS gross_profit,
    ROUND(SAFE_DIVIDE(
        COALESCE(om.revenue_L3, 0) - COALESCE(am.ads_spend_vnd, 0) - COALESCE(om.shipping_cost, 0),
        NULLIF(COALESCE(om.revenue_L3, 0), 0)
    ) * 100, 1) AS margin_pct,
    ROUND(SAFE_DIVIDE(om.revenue_L3, NULLIF(am.ads_spend_vnd, 0)), 2) AS market_roas,
    ROUND(SAFE_DIVIDE(om.success_orders, NULLIF(om.success_orders + om.returned_orders + om.cancelled_orders, 0)) * 100, 1) AS delivery_rate_pct,
    ROUND(SAFE_DIVIDE(om.returned_orders, NULLIF(om.total_orders, 0)) * 100, 1) AS return_rate_pct,
    ROUND(SAFE_DIVIDE(om.revenue_L1, NULLIF(om.total_orders, 0)), 0) AS market_aov
    
FROM order_by_market om
FULL OUTER JOIN ads_by_market am 
    ON om.report_date = am.report_date 
    AND om.market_code = am.market_code
;
