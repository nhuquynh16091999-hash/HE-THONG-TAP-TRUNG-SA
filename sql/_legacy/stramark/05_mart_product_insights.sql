-- ═══════════════════════════════════════════════════
-- mart_product_insights v5
-- Source of Truth: sql/stramark/05_mart_product_insights.sql
-- DO NOT modify via Python scripts
-- ═══════════════════════════════════════════════════
-- v5 CHANGES (2026-03-20):
--   1. FIX: item_orders no longer double-divides retail_price / avg_imported_price
--      (fact_order_items_dedup already divides by 100)
--   2. FIX: ads JOIN now includes market dimension to prevent cross-market duplication
--   3. FIX: ad_order_products uses derived_market directly (already mapped in vw_fact_orders)
-- v4 CHANGES (2026-02-16):
--   1. Ads ↔ Marketer/Product join now uses ad_id → vw_fact_orders attribution
--   2. Product matching via ad_id → order → order_items → product_id
-- ═══════════════════════════════════════════════════

CREATE OR REPLACE VIEW `levelup-465304.STRAMARK_Dataset.mart_product_insights` AS
WITH fx AS (
    SELECT rate FROM `levelup-465304.STRAMARK_Dataset.cost_exchange_rates`
    WHERE from_currency = 'USD' AND to_currency = 'RON'
    ORDER BY effective_date DESC LIMIT 1
),

-- Build ad_id → (marketer_id, product_code) from actual order data
-- derived_market is already mapped via dim_market_mapping in vw_fact_orders
ad_order_products AS (
    SELECT
        o.resolved_ad_id AS ad_id,
        o.marketer_id,
        COALESCE(pi.custom_id, 'UNKNOWN') AS product_code,
        o.derived_market AS market,
        SUM(oi.line_revenue) AS ad_product_revenue
    FROM `levelup-465304.STRAMARK_Dataset.vw_fact_orders` o
    JOIN `levelup-465304.STRAMARK_Dataset.fact_order_items_dedup` oi ON o.order_id = oi.order_id
    LEFT JOIN `levelup-465304.STRAMARK_Dataset.product_template` pi ON oi.product_id = pi.id
    WHERE o.resolved_ad_id IS NOT NULL
    GROUP BY 1, 2, 3, 4
),

-- For each ad, find the dominant marketer and product
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

-- Fallback: campaign name parse
mkter_lookup AS (
    SELECT marketer_id, ANY_VALUE(campaign_code) AS campaign_code
    FROM `levelup-465304.STRAMARK_Dataset.dim_marketer_mapping` GROUP BY marketer_id
),

-- Enrich ads with attribution
ads_enriched AS (
    SELECT
        SAFE_CAST(a.date AS DATE) AS report_date,
        -- Product: from order attribution OR campaign parse
        UPPER(TRIM(COALESCE(ap.product_code, SPLIT(a.campaign_name, ' - ')[SAFE_OFFSET(1)], 'UNKNOWN'))) AS product_code,
        -- Marketer: from order attribution OR campaign parse
        COALESCE(ap.marketer_id, ml.marketer_id, 'UNMATCHED') AS marketer_id,
        -- Market: from order attribution OR dim_market_mapping only
        -- Do NOT fall back to raw campaign split (avoids CĐ, DS etc. which are targeting types, not countries)
        -- v5.1: Add CASE WHEN fallback for known market codes at position [2]
        COALESCE(
            ap.market,
            mkt.market_name,
            CASE UPPER(TRIM(SPLIT(a.campaign_name, ' - ')[SAFE_OFFSET(2)]))
                WHEN 'RO' THEN 'Romania'
                WHEN 'BG' THEN 'Bulgaria'
                WHEN 'SK' THEN 'Slovakia'
                WHEN 'HR' THEN 'Croatia'
                WHEN 'ROMANIA' THEN 'Romania'
                WHEN 'BULGARIA' THEN 'Bulgaria'
                WHEN 'SLOVAKIA' THEN 'Slovakia'
                WHEN 'CROATIA' THEN 'Croatia'
                ELSE 'Unknown'
            END
        ) AS market,
        a.spend AS ads_spend_usd
    FROM `levelup-465304.STRAMARK_Dataset.fb_ads_data` a
    LEFT JOIN ad_primary ap ON a.ad_id = ap.ad_id
    LEFT JOIN mkter_lookup ml 
        ON UPPER(TRIM(SPLIT(a.campaign_name, ' - ')[SAFE_OFFSET(5)])) = UPPER(TRIM(ml.campaign_code))
    LEFT JOIN `levelup-465304.STRAMARK_Dataset.dim_market_mapping` mkt 
        ON LOWER(TRIM(SPLIT(a.campaign_name, ' - ')[SAFE_OFFSET(2)])) = LOWER(mkt.raw_market)
),
ads_by_product AS (
    SELECT report_date, product_code, marketer_id, market,
        SUM(ads_spend_usd) AS ads_spend_usd
    FROM ads_enriched
    GROUP BY 1, 2, 3, 4
),

-- Order-level product aggregation
-- fact_order_items_dedup already casts types and divides prices by 100
-- Fallback: if retail_price = 0 (POS sync gap), distribute order total_price evenly by quantity
-- v5.1 COGS FIX: 3-level fallback (product_cogs → avg_imported_price → product_variations)
-- Previously only used oi.avg_imported_price → D06/D07/V02 showed COGS = 0 because their
-- avg_imported_price is null/0 but product_cogs.cost_raw has valid data.
-- ⚠️ product_cogs.cost_raw is stored × 100 (bani/cents) → must divide by 100 to match
--    the scale of oi.avg_imported_price which fact_order_items_dedup already divides.
item_orders AS (
    SELECT o.order_date, o.order_id, o.marketer_id, o.marketer_name,
        o.status_group, o.derived_market AS market, o.derived_market_code AS market_code,
        oi.product_id, oi.product_name AS item_product_name,
        oi.quantity AS qty,
        oi.return_quantity AS return_qty,
        COALESCE(NULLIF(oi.retail_price, 0), SAFE_DIVIDE(o.total_price, o.total_quantity)) AS unit_price,
        COALESCE(
            NULLIF(pc.cost_raw / 100.0, 0),                                     -- 1st: product_cogs (÷100 for scale)
            NULLIF(oi.avg_imported_price, 0),                                   -- 2nd: order_items avg (already ÷100)
            NULLIF(SAFE_CAST(pv.imported_price AS FLOAT64) / 100.0, 0),         -- 3rd: product_variations (÷100)
            0
        ) AS unit_cogs
    FROM `levelup-465304.STRAMARK_Dataset.vw_fact_orders` o
    JOIN `levelup-465304.STRAMARK_Dataset.fact_order_items_dedup` oi ON o.order_id = oi.order_id
    LEFT JOIN `levelup-465304.STRAMARK_Dataset.product_cogs` pc ON oi.variation_id = pc.variation_id
    LEFT JOIN `levelup-465304.STRAMARK_Dataset.product_variations` pv ON oi.variation_id = pv.id
),
product_info AS (
    SELECT DISTINCT id AS product_id, custom_id, name AS product_name
    FROM `levelup-465304.STRAMARK_Dataset.product_template`
),
product_agg AS (
    SELECT io.order_date AS report_date,
        COALESCE(pi.custom_id, 'UNKNOWN') AS product_code,
        COALESCE(pi.product_name, io.item_product_name) AS product_name,
        io.marketer_id, ANY_VALUE(io.marketer_name) AS marketer_name,
        io.market, io.market_code,
        COUNT(DISTINCT io.order_id) AS order_count,
        SUM(io.qty) AS units_sold,
        SUM(CASE WHEN io.status_group = 'success' THEN io.qty ELSE 0 END) AS units_delivered,
        SUM(COALESCE(io.return_qty, 0)) AS units_returned,
        ROUND(SUM(CASE WHEN io.status_group = 'success' THEN io.qty * io.unit_price ELSE 0 END), 2) AS delivered_revenue,
        ROUND(SUM(io.qty * io.unit_cogs), 2) AS total_cogs,
        ROUND(SUM(CASE WHEN io.status_group = 'success' THEN io.qty * io.unit_cogs ELSE 0 END), 2) AS delivered_cogs
    FROM item_orders io
    LEFT JOIN product_info pi ON io.product_id = pi.product_id
    GROUP BY 1, 2, 3, 4, 6, 7
)

SELECT
    pa.report_date, pa.product_code, pa.product_name,
    pa.marketer_id, pa.marketer_name, pa.market, pa.market_code,
    pa.order_count, pa.units_sold, pa.units_delivered, pa.units_returned,
    ROUND(pa.delivered_revenue, 0) AS delivered_revenue,
    ROUND(pa.delivered_cogs, 0) AS delivered_cogs,
    ROUND(pa.delivered_revenue - pa.delivered_cogs, 0) AS gross_profit,
    ROUND(SAFE_DIVIDE(pa.delivered_revenue - pa.delivered_cogs, NULLIF(pa.delivered_revenue, 0)) * 100, 1) AS margin_pct,
    ROUND(COALESCE(ap.ads_spend_usd, 0), 2) AS ads_spend_usd,
    ROUND(COALESCE(ap.ads_spend_usd, 0) * fx.rate, 0) AS ads_spend_ron,
    ROUND(SAFE_DIVIDE(ap.ads_spend_usd * fx.rate, NULLIF(pa.units_delivered, 0)), 2) AS cpps_ron,
    ROUND(SAFE_DIVIDE(pa.delivered_revenue, NULLIF(ap.ads_spend_usd * fx.rate, 0)), 2) AS product_roas,
    ROUND(SAFE_DIVIDE(pa.units_returned, NULLIF(pa.units_sold, 0)) * 100, 1) AS product_return_rate
FROM product_agg pa
LEFT JOIN ads_by_product ap
    ON pa.report_date = ap.report_date
    AND UPPER(TRIM(pa.product_code)) = ap.product_code
    AND pa.marketer_id = ap.marketer_id
    AND pa.market = ap.market
CROSS JOIN fx
;
