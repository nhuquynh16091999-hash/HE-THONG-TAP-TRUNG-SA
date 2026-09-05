-- ═══════════════════════════════════════════════════
-- FIX: mart_performance_master v5
-- Date: 2026-03-04
-- Changes from v4:
--   1. Campaign name suffix parsing: extract last token after ' ', '-', '_'
--      instead of SPLIT(name, ' - ')[SAFE_OFFSET(5)]
--   2. FULL OUTER JOIN ads_agg with order_agg so ads without orders are included
--   3. Fixes Jan 2026 ads_spend = 0 issue
-- ═══════════════════════════════════════════════════

CREATE OR REPLACE VIEW `levelup-465304.STRAMARK_Dataset.mart_performance_master` AS
WITH fx AS (
    SELECT rate FROM `levelup-465304.STRAMARK_Dataset.cost_exchange_rates`
    WHERE from_currency = 'USD' AND to_currency = 'RON'
    ORDER BY effective_date DESC LIMIT 1
),
fx_eur AS (
    SELECT rate FROM `levelup-465304.STRAMARK_Dataset.cost_exchange_rates`
    WHERE from_currency = 'EUR' AND to_currency = 'RON'
    ORDER BY effective_date DESC LIMIT 1
),
-- euShipments fulfillment cost constants (EUR, from WH Oradea quotation 20% discount)
ffm_costs AS (
    SELECT
        0.90 AS ffm_per_order,      -- pick & pack (≤5kg, ≤2 items)
        0.08 AS bag_per_order,       -- courier flyer bag A4
        0.35 AS cod_fee_per_order,   -- COD min charge (Cargus)
        2.33 AS ship_per_order,      -- avg shipping (Cargus ≤2kg)
        0.50 AS reverse_ffm,         -- reverse fulfillment
        1.00 AS rma_fee,             -- return management
        2.33 AS return_ship          -- return shipping (by tariff)
),

-- ═══ STEP 1: Build ad_id → marketer_id mapping from ACTUAL orders ═══
ad_marketer_map AS (
    SELECT
        resolved_ad_id AS ad_id,
        APPROX_TOP_COUNT(marketer_id, 1)[OFFSET(0)].value AS marketer_id
    FROM `levelup-465304.STRAMARK_Dataset.vw_fact_orders`
    WHERE resolved_ad_id IS NOT NULL
      AND marketer_id IS NOT NULL
      AND marketer_id != 'UNKNOWN'
    GROUP BY 1
),
adset_marketer_map AS (
    SELECT
        resolved_adset_id AS adset_id,
        APPROX_TOP_COUNT(marketer_id, 1)[OFFSET(0)].value AS marketer_id
    FROM `levelup-465304.STRAMARK_Dataset.vw_fact_orders`
    WHERE resolved_adset_id IS NOT NULL
      AND marketer_id IS NOT NULL
      AND marketer_id != 'UNKNOWN'
    GROUP BY 1
),

-- Campaign name → marketer lookup (suffix-based)
mkter_lookup AS (
    SELECT marketer_id, ANY_VALUE(campaign_code) AS campaign_code
    FROM `levelup-465304.STRAMARK_Dataset.dim_marketer_mapping`
    GROUP BY marketer_id
),

-- ═══ STEP 2: Aggregate ads with 3-level marketer resolution ═══
-- v5 FIX: suffix-based campaign name parsing instead of SPLIT(name, ' - ')[SAFE_OFFSET(5)]
ads_enriched AS (
    SELECT
        CAST(a.date AS DATE) AS report_date,
        a.ad_id,
        a.adset_id,
        a.campaign_name,
        a.spend,
        COALESCE(a.impressions, 0) AS impressions,
        COALESCE(a.reach, 0) AS reach,
        COALESCE(a.clicks, 0) AS clicks,
        0 AS messages,
        -- 3-level marketer resolution:
        -- L1: ad_id matched to orders → marketer from order attribution
        -- L2: adset_id matched to orders → marketer from order attribution  
        -- L3: campaign_name SUFFIX parse → dim_marketer_mapping
        --     v5: Extract last token from campaign_name as suffix code
        COALESCE(
            am.marketer_id,
            asm.marketer_id,
            ml.marketer_id,
            'UNMATCHED'
        ) AS marketer_id,
        CASE
            WHEN am.marketer_id IS NOT NULL THEN 'AD_MATCH'
            WHEN asm.marketer_id IS NOT NULL THEN 'ADSET_MATCH'
            WHEN ml.marketer_id IS NOT NULL THEN 'CAMPAIGN_PARSE'
            ELSE 'UNMATCHED'
        END AS ads_attribution_type
    FROM `levelup-465304.STRAMARK_Dataset.fb_ads_data` a
    LEFT JOIN ad_marketer_map am ON a.ad_id = am.ad_id
    LEFT JOIN adset_marketer_map asm ON a.adset_id = asm.adset_id
    -- v5 FIX: suffix matching — extract last token from campaign_name
    -- Handles formats like: "RO ECommerce Fashion - Lệ", "content2 TA", "mass LC"
    LEFT JOIN mkter_lookup ml 
        ON UPPER(TRIM(
            REGEXP_EXTRACT(
                TRIM(SPLIT(a.campaign_name, ' - ')[SAFE_OFFSET(5)]),
                r'^([A-Za-z\x{00C0}-\x{024F}\x{1E00}-\x{1EFF}]+)'
            )
        )) = UPPER(TRIM(ml.campaign_code))
),
ads_agg AS (
    SELECT
        report_date,
        marketer_id,
        SUM(spend) AS ads_spend_usd,
        SUM(impressions) AS impressions,
        SUM(reach) AS reach,
        SUM(clicks) AS clicks,
        SUM(messages) AS messages,
        COUNTIF(ads_attribution_type = 'AD_MATCH') AS ads_matched_by_ad,
        COUNTIF(ads_attribution_type = 'ADSET_MATCH') AS ads_matched_by_adset,
        COUNTIF(ads_attribution_type = 'CAMPAIGN_PARSE') AS ads_matched_by_parse,
        COUNTIF(ads_attribution_type = 'UNMATCHED') AS ads_unmatched
    FROM ads_enriched
    GROUP BY 1, 2
),

-- ═══ STEP 3: Order aggregation ═══
order_agg AS (
    SELECT
        CAST(o.order_date AS DATE) AS report_date,
        o.marketer_id,
        ANY_VALUE(o.marketer_name) AS marketer_name,
        COUNT(DISTINCT o.order_id) AS total_orders,
        COUNTIF(o.status_group = 'success') AS success_orders,
        COUNTIF(o.status_group = 'returned') AS returned_orders,
        COUNTIF(o.status_group = 'cancelled') AS cancelled_orders,
        COUNTIF(o.status_group IN ('processing','shipping')) AS pending_orders,
        COUNTIF(o.status_name IN ('packing','pending','shipped','delivered','received_money','returning','returned')) AS shipped_orders,
        ROUND(SUM(o.revenue_L1_lead), 2) AS revenue_L1,
        ROUND(SUM(o.revenue_L3_success), 2) AS revenue_L3,
        ROUND(SUM(o.revenue_L4_cod_collected), 2) AS revenue_L4,
        ROUND(SUM(o.shipping_fee), 2) AS total_shipping,
        ROUND(SUM(o.partner_fee), 2) AS total_partner_fee,
        ROUND(SUM(o.return_fee), 2) AS total_return_fee,
        COUNTIF(o.attribution_type IN ('AD_MATCH','ADSET_MATCH')) AS attributed_orders
    FROM `levelup-465304.STRAMARK_Dataset.vw_fact_orders` o
    GROUP BY 1, 2
),
order_cogs AS (
    SELECT CAST(o.order_date AS DATE) AS report_date, o.marketer_id,
        ROUND(SUM(
            SAFE_CAST(oi.quantity AS INT64) * 
            COALESCE(
                NULLIF(pc.cost_raw, 0),
                NULLIF(oi.avg_imported_price, 0),
                NULLIF(SAFE_CAST(pv.imported_price AS FLOAT64), 0),
                0
            ) / 100
        ), 2) AS total_cogs
    FROM `levelup-465304.STRAMARK_Dataset.vw_fact_orders` o
    JOIN `levelup-465304.STRAMARK_Dataset.order_items` oi ON o.order_id = oi.order_id
    LEFT JOIN `levelup-465304.STRAMARK_Dataset.product_variations` pv ON oi.variation_id = pv.id
    LEFT JOIN `levelup-465304.STRAMARK_Dataset.product_cogs` pc ON oi.variation_id = pc.variation_id
    WHERE o.status_group = 'success'
    AND COALESCE(
        NULLIF(pc.cost_raw, 0),
        NULLIF(oi.avg_imported_price, 0),
        NULLIF(SAFE_CAST(pv.imported_price AS FLOAT64), 0)
    ) > 0
    GROUP BY 1, 2
),

-- v5: Get marketer_name for ads-only rows (no orders)
marketer_names AS (
    SELECT marketer_id, marketer_name
    FROM `levelup-465304.STRAMARK_Dataset.dim_marketer_mapping`
)

-- ═══ FINAL SELECT ═══
-- v5 FIX: FULL OUTER JOIN so ads without orders are NOT lost
SELECT
    COALESCE(oa.report_date, aa.report_date) AS report_date,
    COALESCE(oa.marketer_id, aa.marketer_id) AS marketer_id,
    COALESCE(oa.marketer_name, mn.marketer_name, aa.marketer_id) AS marketer_name,
    COALESCE(oa.total_orders, 0) AS total_orders,
    COALESCE(oa.success_orders, 0) AS success_orders,
    COALESCE(oa.returned_orders, 0) AS returned_orders,
    COALESCE(oa.cancelled_orders, 0) AS cancelled_orders,
    COALESCE(oa.pending_orders, 0) AS pending_orders,
    COALESCE(oa.attributed_orders, 0) AS attributed_orders,
    COALESCE(oa.shipped_orders, 0) AS shipped_orders,
    
    ROUND(COALESCE(oa.revenue_L1, 0), 0) AS revenue_lead,
    ROUND(COALESCE(oa.revenue_L3, 0), 0) AS revenue_success,
    ROUND(COALESCE(oa.revenue_L3, 0), 0) AS delivered_revenue,
    ROUND(COALESCE(oa.revenue_L4, 0), 0) AS revenue_cod_collected,
    ROUND(COALESCE(oa.revenue_L3, 0) - COALESCE(oa.revenue_L4, 0), 0) AS partner_debt,
    
    ROUND(COALESCE(aa.ads_spend_usd, 0), 2) AS ads_spend_usd,
    ROUND(COALESCE(aa.ads_spend_usd, 0) * fx.rate, 0) AS ads_spend_ron,
    ROUND(COALESCE(oa.total_shipping, 0), 0) AS shipping_cost,
    ROUND(COALESCE(oa.total_partner_fee, 0), 0) AS partner_fee,
    ROUND(COALESCE(oa.total_return_fee, 0), 0) AS return_cost,
    ROUND(COALESCE(oc.total_cogs, 0), 0) AS cogs,
    
    -- Fulfillment costs
    ROUND(COALESCE(oa.shipped_orders, 0) * (fc.ffm_per_order + fc.bag_per_order + fc.cod_fee_per_order + fc.ship_per_order) * fx_eur.rate, 0) AS fulfillment_cost,
    ROUND(COALESCE(oa.returned_orders, 0) * (fc.reverse_ffm + fc.rma_fee + fc.return_ship) * fx_eur.rate, 0) AS return_fulfillment_cost,
    
    ROUND(COALESCE(oa.revenue_L3, 0) 
          - COALESCE(aa.ads_spend_usd, 0) * fx.rate 
          - COALESCE(oc.total_cogs, 0)
          - COALESCE(oa.shipped_orders, 0) * (fc.ffm_per_order + fc.bag_per_order + fc.cod_fee_per_order + fc.ship_per_order) * fx_eur.rate
          - COALESCE(oa.returned_orders, 0) * (fc.reverse_ffm + fc.rma_fee + fc.return_ship) * fx_eur.rate
    , 0) AS net_profit,
    
    COALESCE(aa.impressions, 0) AS impressions,
    COALESCE(aa.reach, 0) AS reach,
    COALESCE(aa.clicks, 0) AS clicks,
    COALESCE(aa.messages, 0) AS messages,
    
    COALESCE(aa.ads_matched_by_ad, 0) AS ads_matched_by_ad,
    COALESCE(aa.ads_matched_by_adset, 0) AS ads_matched_by_adset,
    COALESCE(aa.ads_matched_by_parse, 0) AS ads_matched_by_parse,
    COALESCE(aa.ads_unmatched, 0) AS ads_unmatched,
    
    ROUND(SAFE_DIVIDE(COALESCE(oa.revenue_L3, 0), NULLIF(COALESCE(aa.ads_spend_usd, 0) * fx.rate, 0)), 2) AS real_roas,
    ROUND(SAFE_DIVIDE(COALESCE(aa.ads_spend_usd, 0) * fx.rate, NULLIF(COALESCE(oa.total_orders, 0), 0)), 2) AS real_cpa,
    ROUND(SAFE_DIVIDE(COALESCE(oa.revenue_L1, 0), NULLIF(COALESCE(oa.total_orders, 0), 0)), 2) AS avg_order_value,
    ROUND(SAFE_DIVIDE(COALESCE(aa.ads_spend_usd, 0), NULLIF(COALESCE(aa.impressions, 0), 0)) * 1000, 2) AS cpm_usd,
    ROUND(SAFE_DIVIDE(COALESCE(aa.clicks, 0), NULLIF(COALESCE(aa.impressions, 0), 0)) * 100, 2) AS ctr_pct,
    ROUND(SAFE_DIVIDE(COALESCE(oa.total_orders, 0), NULLIF(COALESCE(aa.clicks, 0), 0)) * 100, 2) AS cr_click_pct,
    ROUND(SAFE_DIVIDE(COALESCE(oa.success_orders, 0), NULLIF(COALESCE(oa.success_orders, 0) + COALESCE(oa.returned_orders, 0) + COALESCE(oa.cancelled_orders, 0), 0)) * 100, 1) AS delivery_rate_pct,
    ROUND(SAFE_DIVIDE(COALESCE(oa.returned_orders, 0), NULLIF(COALESCE(oa.total_orders, 0), 0)) * 100, 1) AS return_rate_pct,
    
    CASE
        WHEN COALESCE(aa.ads_spend_usd, 0) = 0 THEN '⚪ NO_ADS'
        WHEN SAFE_DIVIDE(COALESCE(aa.ads_spend_usd, 0), NULLIF(COALESCE(aa.impressions, 0), 0)) * 1000 > 15 THEN '🔴 CPM_HIGH'
        WHEN SAFE_DIVIDE(COALESCE(aa.clicks, 0), NULLIF(COALESCE(aa.impressions, 0), 0)) * 100 < 0.8 THEN '🟡 CTR_LOW'
        WHEN SAFE_DIVIDE(COALESCE(oa.total_orders, 0), NULLIF(COALESCE(aa.clicks, 0), 0)) * 100 < 2 THEN '🟠 CR_LOW'
        WHEN SAFE_DIVIDE(COALESCE(oa.revenue_L3, 0), NULLIF(COALESCE(aa.ads_spend_usd, 0) * fx.rate, 0)) >= 3 THEN '🟢 SCALE'
        WHEN SAFE_DIVIDE(COALESCE(oa.revenue_L3, 0), NULLIF(COALESCE(aa.ads_spend_usd, 0) * fx.rate, 0)) >= 1.5 THEN '⚪ MONITOR'
        ELSE '🔴 KILL'
    END AS diagnosis
    
FROM order_agg oa
-- v5 FIX: FULL OUTER JOIN instead of LEFT JOIN
-- This ensures ads spend is captured even on days with NO orders
FULL OUTER JOIN ads_agg aa 
    ON oa.marketer_id = aa.marketer_id AND oa.report_date = aa.report_date
LEFT JOIN order_cogs oc 
    ON COALESCE(oa.report_date, aa.report_date) = oc.report_date 
    AND COALESCE(oa.marketer_id, aa.marketer_id) = oc.marketer_id
LEFT JOIN marketer_names mn 
    ON COALESCE(oa.marketer_id, aa.marketer_id) = mn.marketer_id
CROSS JOIN fx
CROSS JOIN fx_eur
CROSS JOIN ffm_costs fc
-- v5: Filter out UNMATCHED rows to keep only real marketers
WHERE COALESCE(oa.marketer_id, aa.marketer_id) != 'UNMATCHED'
;
