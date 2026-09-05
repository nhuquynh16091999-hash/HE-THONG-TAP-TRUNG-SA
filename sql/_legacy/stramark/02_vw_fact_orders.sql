-- ═══════════════════════════════════════════════════
-- vw_fact_orders v3 — Master order view
-- Source of Truth: sql/stramark/02_vw_fact_orders.sql
-- DO NOT modify via Python scripts
-- ═══════════════════════════════════════════════════
-- KEY FEATURES:
--   1. Multi-source attribution: AD_MATCH → ADSET_MATCH → ORGANIC_FB → UNKNOWN
--   2. Adset matching uses BOTH fb_ads_data AND fb_adset_data (UNION ALL)
--   3. Marketer: 4-level priority (PAGE → DIM_MAPPING → RAW_FIELD → UNKNOWN)
--   4. Market/Product/Type parsed from campaign name
--   5. Revenue tiers: L1 (lead) → L2 (shipped) → L3 (success) → L4 (COD)
--   6. p_utm_campaign fallback for market derivation when no ads match
-- ═══════════════════════════════════════════════════

CREATE OR REPLACE VIEW `levelup-465304.STRAMARK_Dataset.vw_fact_orders` AS
WITH orders_clean AS (
    SELECT
        o.id AS order_id, o.shop_id,
        SAFE_CAST(o.status AS INT64) AS status_code, o.status_name,
        ROUND(SAFE_CAST(o.total_price AS FLOAT64) / 100, 2) AS total_price,
        ROUND(SAFE_CAST(o.shipping_fee AS FLOAT64) / 100, 2) AS shipping_fee,
        ROUND(SAFE_CAST(o.cod AS FLOAT64) / 100, 2) AS cod,
        ROUND(SAFE_CAST(o.total_discount AS FLOAT64) / 100, 2) AS total_discount,
        ROUND(SAFE_CAST(o.partner_fee AS FLOAT64) / 100, 2) AS partner_fee,
        ROUND(SAFE_CAST(o.return_fee AS FLOAT64) / 100, 2) AS return_fee,
        ROUND(SAFE_CAST(o.surcharge AS FLOAT64) / 100, 2) AS surcharge,
        ROUND(SAFE_CAST(o.money_to_collect AS FLOAT64) / 100, 2) AS money_to_collect,
        SAFE_CAST(o.total_quantity AS INT64) AS total_quantity,
        CASE
            WHEN o.marketer IS NULL OR o.marketer = '' THEN NULL
            WHEN o.marketer LIKE '%"name"%' THEN
                TRIM(REGEXP_EXTRACT(o.marketer, r'"name":\s*"([^"]*)"'))
            WHEN o.marketer LIKE "%'name'%" THEN
                TRIM(REGEXP_EXTRACT(o.marketer, r"'name':\s*'([^']*)'"))
            ELSE o.marketer
        END AS marketer_raw_name,
        o.ad_id, o.adset_id, o.ads_source, o.page_id, o.post_id,
        o.p_utm_source, o.p_utm_campaign, o.p_utm_medium,
        o.p_utm_content, o.p_utm_term, o.p_utm_id,
        o.order_currency,
        o.customer_id, o.customer_name, o.bill_full_name,
        o.bill_phone_number, o.shipping_address,
        o.shipping_province, o.shipping_district,
        o.partner AS shipping_carrier, o.warehouse_id, o.tracking_link,
        SAFE.PARSE_DATE('%Y-%m-%d', LEFT(o.inserted_at, 10)) AS order_date,
        o.inserted_at, o.updated_at, o.time_send_partner,
        o.estimate_delivery_date,
        o.note, o.tags, o.order_link, o.sync_time,
        -- Resolve best ad_id
        CASE
            WHEN o.p_utm_term IS NOT NULL AND LENGTH(o.p_utm_term) > 10 
                AND REGEXP_CONTAINS(o.p_utm_term, r'^[0-9]+$') THEN o.p_utm_term
            WHEN o.ad_id IS NOT NULL AND o.ad_id != '' THEN o.ad_id
            ELSE NULL
        END AS resolved_ad_id,
        -- Resolve best adset_id
        CASE
            WHEN o.p_utm_medium IS NOT NULL AND LENGTH(o.p_utm_medium) > 10
                AND REGEXP_CONTAINS(o.p_utm_medium, r'^[0-9]+$') THEN o.p_utm_medium
            WHEN o.adset_id IS NOT NULL AND o.adset_id != '' THEN o.adset_id
            ELSE NULL
        END AS resolved_adset_id
    FROM `levelup-465304.STRAMARK_Dataset.sale_order` o
    WHERE o.inserted_at IS NOT NULL AND o.inserted_at != ''
),

-- Campaign info: try ad_id first, then adset_id (from BOTH data sources)
ad_campaign AS (
    SELECT CAST(ad_id AS STRING) AS ad_id, ANY_VALUE(CAST(adset_id AS STRING)) AS adset_id,
        ANY_VALUE(CAST(campaign_name AS STRING)) AS campaign_name,
        ANY_VALUE(CAST(campaign_id AS STRING)) AS campaign_id
    FROM `levelup-465304.STRAMARK_Dataset.fb_ads_data`
    GROUP BY ad_id
),
adset_campaign AS (
    SELECT adset_id,
        ANY_VALUE(campaign_name) AS campaign_name,
        ANY_VALUE(campaign_id) AS campaign_id
    FROM (
        SELECT CAST(adset_id AS STRING) AS adset_id, CAST(campaign_name AS STRING) AS campaign_name, CAST(campaign_id AS STRING) AS campaign_id FROM `levelup-465304.STRAMARK_Dataset.fb_ads_data`
        UNION ALL
        SELECT CAST(adset_id AS STRING) AS adset_id, CAST(campaign_name AS STRING) AS campaign_name, CAST(campaign_id AS STRING) AS campaign_id FROM `levelup-465304.STRAMARK_Dataset.fb_adset_data`
    )
    GROUP BY adset_id
),

-- Marketer mapping
mkter AS (
    SELECT raw_name,
        ANY_VALUE(marketer_id) AS marketer_id,
        ANY_VALUE(marketer_name) AS marketer_name,
        ANY_VALUE(campaign_code) AS campaign_code
    FROM `levelup-465304.STRAMARK_Dataset.dim_marketer_mapping`
    GROUP BY raw_name
),

-- Page-marketer mapping
page_mkter AS (
    SELECT page_id, marketer_id, marketer_name
    FROM `levelup-465304.STRAMARK_Dataset.page_marketer`
    WHERE is_active = TRUE
),

-- Enriched orders with all attribution sources
enriched AS (
    SELECT r.*,
        COALESCE(ac.campaign_name, asc2.campaign_name) AS matched_campaign_name,
        COALESCE(ac.campaign_id, asc2.campaign_id) AS matched_campaign_id,
        CASE
            WHEN ac.ad_id IS NOT NULL THEN 'AD_MATCH'
            WHEN asc2.adset_id IS NOT NULL THEN 'ADSET_MATCH'
            WHEN r.ads_source = 'Facebook' THEN 'ORGANIC_FB'
            WHEN r.ads_source = 'TikTok' THEN 'TIKTOK'
            ELSE 'UNKNOWN'
        END AS attribution_type,
        pm.marketer_id AS page_marketer_id,
        pm.marketer_name AS page_marketer_name
    FROM orders_clean r
    LEFT JOIN ad_campaign ac ON r.resolved_ad_id = ac.ad_id
    LEFT JOIN adset_campaign asc2 ON r.resolved_adset_id = asc2.adset_id
    LEFT JOIN page_mkter pm ON r.page_id = pm.page_id
)
SELECT
    e.order_id, e.shop_id, e.status_code, e.status_name,
    e.total_price, e.shipping_fee, e.cod, e.total_discount,
    e.partner_fee, e.return_fee, e.surcharge, e.money_to_collect,
    e.total_quantity, e.marketer_raw_name,
    e.ad_id, e.adset_id, e.ads_source, e.page_id, e.post_id,
    e.p_utm_source, e.p_utm_campaign, e.p_utm_medium,
    e.p_utm_content, e.p_utm_term, e.p_utm_id,
    e.order_currency,
    e.customer_id, e.customer_name, e.bill_full_name,
    e.bill_phone_number, e.shipping_address,
    e.shipping_province, e.shipping_district,
    e.shipping_carrier, e.warehouse_id, e.tracking_link,
    e.order_date, e.inserted_at, e.updated_at, e.time_send_partner,
    e.estimate_delivery_date, e.note, e.tags, e.order_link, e.sync_time,
    e.resolved_ad_id, e.resolved_adset_id,
    
    -- Status
    COALESCE(sm.status_group, 'unknown') AS status_group,
    COALESCE(sm.display_name, e.status_name) AS status_display,
    sm.revenue_impact,
    
    -- Marketer (4-level priority: page → dim_mapping → raw → Unknown)
    -- Skip page_marketer if it's 'ALL' (shared pages)
    COALESCE(
        CASE WHEN e.page_marketer_id != 'ALL' THEN e.page_marketer_id END,
        mm.marketer_id,
        'UNKNOWN'
    ) AS marketer_id,
    COALESCE(
        CASE WHEN e.page_marketer_id != 'ALL' THEN e.page_marketer_name END,
        mm.marketer_name, e.marketer_raw_name, 'Unknown'
    ) AS marketer_name,
    mm.campaign_code AS marketer_campaign_code,
    CASE
        WHEN e.page_marketer_id IS NOT NULL AND e.page_marketer_id != 'ALL' THEN 'PAGE_MATCH'
        WHEN mm.marketer_id IS NOT NULL THEN 'DIM_MATCH'
        WHEN e.marketer_raw_name IS NOT NULL THEN 'RAW_FIELD'
        ELSE 'UNKNOWN'
    END AS marketer_source,
    
    -- Attribution
    e.attribution_type,
    e.matched_campaign_name,
    e.matched_campaign_id,
    
    -- Market from dim_market_mapping only (raw split may contain targeting types like CĐ, DS)
    COALESCE(
        mkt.market_name,
        'Unknown'
    ) AS derived_market,
    COALESCE(mkt.market_code, 'XX') AS derived_market_code,
    TRIM(SPLIT(COALESCE(e.matched_campaign_name, e.p_utm_campaign), ' - ')[SAFE_OFFSET(1)]) AS derived_product_code,
    TRIM(SPLIT(COALESCE(e.matched_campaign_name, e.p_utm_campaign), ' - ')[SAFE_OFFSET(3)]) AS derived_campaign_type,
    
    -- Revenue tiers
    e.total_price AS revenue_L1_lead,
    CASE WHEN e.status_code IN (2,3,16) THEN e.total_price ELSE 0 END AS revenue_L2_shipped,
    CASE WHEN COALESCE(sm.status_group,'') = 'success' THEN e.total_price ELSE 0 END AS revenue_L3_success,
    CASE WHEN e.status_code = 16 THEN e.total_price ELSE 0 END AS revenue_L4_cod_collected

FROM enriched e
LEFT JOIN `levelup-465304.STRAMARK_Dataset.dim_status_mapping` sm ON e.status_code = sm.status_code
LEFT JOIN mkter mm ON LOWER(TRIM(e.marketer_raw_name)) = LOWER(TRIM(mm.raw_name))
LEFT JOIN `levelup-465304.STRAMARK_Dataset.dim_market_mapping` mkt 
    ON LOWER(TRIM(SPLIT(COALESCE(e.matched_campaign_name, e.p_utm_campaign), ' - ')[SAFE_OFFSET(2)])) = LOWER(mkt.raw_market)
;
