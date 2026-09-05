-- ═══════════════════════════════════════════════════
-- mart_product_insights v1 — AUUS1
-- Source of Truth: sql/auus1/05_mart_product_insights.sql
-- ═══════════════════════════════════════════════════
-- AUUS1: no clicks, messages→messaging_conversation_started, INTEGER types
-- ═══════════════════════════════════════════════════

CREATE OR REPLACE VIEW `levelup-465304.AUUS1_Dataset.mart_product_insights` AS
-- Revenue and spend both VND — no conversion needed
WITH
ad_order_products AS (
    SELECT
        o.resolved_ad_id AS ad_id,
        o.marketer_id,
        COALESCE(pi.custom_id, 'UNKNOWN') AS product_code,
        COALESCE(mkt.market_name, o.derived_market, 'Unknown') AS market,
        SUM(oi.line_revenue) AS ad_product_revenue
    FROM `levelup-465304.AUUS1_Dataset.vw_fact_orders` o
    JOIN `levelup-465304.AUUS1_Dataset.fact_order_items_dedup` oi ON o.order_id = oi.order_id
    LEFT JOIN `levelup-465304.AUUS1_Dataset.product_template` pi ON oi.product_id = pi.id
    LEFT JOIN `levelup-465304.AUUS1_Dataset.dim_market_mapping` mkt 
        ON LOWER(TRIM(o.derived_market)) = LOWER(mkt.raw_market)
    WHERE o.resolved_ad_id IS NOT NULL
    GROUP BY 1, 2, 3, 4
),

ad_primary AS (
    SELECT
        ad_id,
        APPROX_TOP_COUNT(marketer_id, 1)[OFFSET(0)].value AS marketer_id,
        APPROX_TOP_COUNT(product_code, 1)[OFFSET(0)].value AS product_code,
        APPROX_TOP_COUNT(market, 1)[OFFSET(0)].value AS market
    FROM ad_order_products
    WHERE marketer_id IS NOT NULL AND marketer_id != 'UNKNOWN'
    GROUP BY 1
),

mkter_lookup AS (
    SELECT marketer_id, ANY_VALUE(campaign_code) AS campaign_code
    FROM `levelup-465304.AUUS1_Dataset.dim_marketer_mapping` GROUP BY marketer_id
),

ads_enriched AS (
    SELECT
        SAFE.PARSE_DATE('%Y-%m-%d', CAST(a.date AS STRING)) AS report_date,
        COALESCE(ap.marketer_id, ml.marketer_id, 'UNMATCHED') AS marketer_id,
        COALESCE(ap.product_code, TRIM(SPLIT(CAST(a.campaign_name AS STRING), ' - ')[SAFE_OFFSET(1)]), 'UNKNOWN') AS product_code,
        COALESCE(ap.market, TRIM(SPLIT(CAST(a.campaign_name AS STRING), ' - ')[SAFE_OFFSET(2)]), 'Unknown') AS market,
        CAST(a.spend AS FLOAT64) AS spend_vnd,  -- spend in VND
        COALESCE(CAST(a.impressions AS INT64), 0) AS impressions,
        0 AS clicks  -- AUUS1: no clicks column
    FROM `levelup-465304.AUUS1_Dataset.fb_ads_data` a
    LEFT JOIN ad_primary ap ON CAST(a.ad_id AS STRING) = ap.ad_id
    LEFT JOIN mkter_lookup ml 
        ON UPPER(TRIM(SPLIT(CAST(a.campaign_name AS STRING), ' - ')[SAFE_OFFSET(5)])) = UPPER(TRIM(ml.campaign_code))
),
ads_by_product AS (
    SELECT report_date, marketer_id, product_code, market,
        SUM(spend_vnd) AS ads_spend_vnd,
        SUM(impressions) AS impressions,
        SUM(clicks) AS clicks
    FROM ads_enriched
    GROUP BY 1, 2, 3, 4
),

order_products AS (
    SELECT
        o.order_date AS report_date,
        o.marketer_id,
        COALESCE(pi.custom_id, 'UNKNOWN') AS product_code,
        ANY_VALUE(COALESCE(pi.name, oi.product_name)) AS product_name,
        o.derived_market AS market,
        COUNT(DISTINCT o.order_id) AS total_orders,
        COUNTIF(o.status_group = 'success') AS success_orders,
        COUNTIF(o.status_group = 'returned') AS returned_orders,
        SUM(oi.quantity) AS total_quantity,
        ROUND(SUM(oi.line_revenue), 2) AS revenue,
        ROUND(SUM(oi.line_cogs), 2) AS cogs,
        ROUND(SUM(oi.line_revenue) - SUM(oi.line_cogs), 2) AS gross_profit,
        ROUND(SAFE_DIVIDE(SUM(oi.line_revenue) - SUM(oi.line_cogs), NULLIF(SUM(oi.line_revenue), 0)) * 100, 1) AS margin,
        ROUND(SAFE_DIVIDE(SUM(CASE WHEN o.status_group = 'returned' THEN oi.quantity ELSE 0 END),
            NULLIF(SUM(oi.quantity), 0)) * 100, 1) AS return_rate
    FROM `levelup-465304.AUUS1_Dataset.vw_fact_orders` o
    JOIN `levelup-465304.AUUS1_Dataset.fact_order_items_dedup` oi ON o.order_id = oi.order_id
    LEFT JOIN `levelup-465304.AUUS1_Dataset.product_template` pi ON oi.product_id = pi.id
    GROUP BY 1, 2, 3, 5
)

SELECT
    COALESCE(op.report_date, ap.report_date) AS report_date,
    COALESCE(op.marketer_id, ap.marketer_id) AS marketer_id,
    COALESCE(op.product_code, ap.product_code) AS product_code,
    op.product_name,
    COALESCE(op.market, ap.market, 'Unknown') AS market,
    COALESCE(op.total_orders, 0) AS total_orders,
    COALESCE(op.total_orders, 0) AS order_count,
    COALESCE(op.success_orders, 0) AS success_orders,
    COALESCE(op.returned_orders, 0) AS returned_orders,
    COALESCE(op.total_quantity, 0) AS total_quantity,
    ROUND(COALESCE(op.revenue, 0), 0) AS revenue,
    ROUND(COALESCE(op.revenue, 0), 0) AS delivered_revenue,
    ROUND(COALESCE(op.cogs, 0), 0) AS cogs,
    ROUND(COALESCE(op.gross_profit, 0), 0) AS gross_profit,
    COALESCE(op.margin, 0) AS margin,
    COALESCE(op.return_rate, 0) AS return_rate,
    ROUND(COALESCE(ap.ads_spend_vnd, 0), 0) AS ads_spend_vnd,
    ROUND(COALESCE(ap.ads_spend_vnd, 0), 0) AS ads_spend,
    ROUND(COALESCE(op.gross_profit, 0) - COALESCE(ap.ads_spend_vnd, 0), 0) AS net_profit,
    ROUND(SAFE_DIVIDE(op.revenue, NULLIF(ap.ads_spend_vnd, 0)), 2) AS product_roas,
    COALESCE(ap.impressions, 0) AS impressions,
    COALESCE(ap.clicks, 0) AS clicks

FROM order_products op
FULL OUTER JOIN ads_by_product ap 
    ON op.report_date = ap.report_date 
    AND op.marketer_id = ap.marketer_id 
    AND op.product_code = ap.product_code 
    AND op.market = ap.market
;
