-- ═══════════════════════════════════════════════════
-- mart_performance_master v4
-- Source of Truth: sql/stramark/03_mart_performance_master.sql
-- DO NOT modify via Python scripts
-- ═══════════════════════════════════════════════════
-- v4 CHANGES (2026-02-16):
--   1. Ads ↔ Marketer join now uses ad_id → vw_fact_orders attribution
--      instead of fragile SPLIT(campaign_name)[OFFSET(5)]
--   2. 3-level fallback: ad_id → adset_id → campaign_name parse
--   3. Handles unmatched ads (no orders) via campaign_name parse
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
-- vw_fact_orders already resolves marketer via 4-level priority (PAGE → DIM → RAW → UNKNOWN)
-- and resolved_ad_id/resolved_adset_id via UTM params
ad_marketer_map AS (
    SELECT
        resolved_ad_id AS ad_id,
        -- Pick the most common marketer for each ad (mode)
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

-- Campaign name parse fallback (for ads with no matched orders)
mkter_lookup AS (
    SELECT marketer_id, ANY_VALUE(campaign_code) AS campaign_code
    FROM `levelup-465304.STRAMARK_Dataset.dim_marketer_mapping`
    GROUP BY marketer_id
),

-- ═══ STEP 2: Aggregate ads with 3-level marketer resolution ═══
ads_enriched AS (
    SELECT
        SAFE_CAST(a.date AS DATE) AS report_date,
        a.ad_id,
        a.adset_id,
        a.campaign_name,
        a.spend,
        COALESCE(a.impressions, 0) AS impressions,
        COALESCE(a.reach, 0) AS reach,
        COALESCE(a.clicks, 0) AS clicks,
        COALESCE(a.messaging_conversations_started, 0) AS messages,
        -- 3-level marketer resolution:
        -- L1: ad_id matched to orders → marketer from order attribution
        -- L2: adset_id matched to orders → marketer from order attribution  
        -- L3: campaign_name parse → dim_marketer_mapping (original fallback)
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
    LEFT JOIN mkter_lookup ml 
        ON UPPER(TRIM(SPLIT(a.campaign_name, ' - ')[SAFE_OFFSET(5)])) = UPPER(TRIM(ml.campaign_code))
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
        -- Track attribution quality
        COUNTIF(ads_attribution_type = 'AD_MATCH') AS ads_matched_by_ad,
        COUNTIF(ads_attribution_type = 'ADSET_MATCH') AS ads_matched_by_adset,
        COUNTIF(ads_attribution_type = 'CAMPAIGN_PARSE') AS ads_matched_by_parse,
        COUNTIF(ads_attribution_type = 'UNMATCHED') AS ads_unmatched
    FROM ads_enriched
    GROUP BY 1, 2
),

-- ═══ STEP 3: Order aggregation ═══
-- NOTE: shipped_orders = orders that went through 3PL (after TCE export)
-- Per SOP: packing, pending(cho_chuyen_hang), shipped, delivered, received_money, returning, returned
-- EXCLUDED from 3PL: new, submitted, waitting, ordered, canceled (never reached warehouse)
order_agg AS (
    SELECT
        o.order_date AS report_date,
        o.marketer_id,
        ANY_VALUE(o.marketer_name) AS marketer_name,
        COUNT(DISTINCT o.order_id) AS total_orders,
        COUNTIF(o.status_group = 'success') AS success_orders,
        COUNTIF(o.status_group = 'returned') AS returned_orders,
        COUNTIF(o.status_group = 'cancelled') AS cancelled_orders,
        COUNTIF(o.status_group IN ('processing','shipping')) AS pending_orders,
        -- Orders that 3PL actually processed (after TCE export)
        -- = all orders EXCEPT those still before TCE (new, confirmed, cancelled, waitting as 'cho hang')
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
    -- COGS = giá vốn hàng bán: CHỈ tính cho đơn thành công (success)
    -- Đơn hoàn/hủy: hàng quay lại kho → không ghi nhận COGS
    -- Priority: product_cogs.cost_raw > order_items.avg_imported_price > product_variations.imported_price
    -- All values are in bani (RON × 100), divide by 100 to get RON
    SELECT o.order_date AS report_date, o.marketer_id,
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
    WHERE o.status_group = 'success'  -- COGS chỉ ghi nhận khi revenue được ghi nhận
    AND COALESCE(
        NULLIF(pc.cost_raw, 0),
        NULLIF(oi.avg_imported_price, 0),
        NULLIF(SAFE_CAST(pv.imported_price AS FLOAT64), 0)
    ) > 0
    GROUP BY 1, 2
),

-- Marketer name lookup for ads-only rows (no orders yet)
mkter_names AS (
    SELECT marketer_id, ANY_VALUE(marketer_name) AS marketer_name
    FROM `levelup-465304.STRAMARK_Dataset.dim_marketer_mapping`
    GROUP BY 1
)

-- ═══ FINAL SELECT (FULL OUTER JOIN: shows marketers with ads-only OR orders-only) ═══
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

    -- Fulfillment costs (EUR → RON): ONLY for orders that went through 3PL (after TCE export)
    ROUND(COALESCE(oa.shipped_orders, 0) * (fc.ffm_per_order + fc.bag_per_order + fc.cod_fee_per_order + fc.ship_per_order) * fx_eur.rate, 0) AS fulfillment_cost,
    -- Return costs (EUR → RON): reverse FFM + RMA + return shipping per returned order
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

    -- Ads attribution quality
    COALESCE(aa.ads_matched_by_ad, 0) AS ads_matched_by_ad,
    COALESCE(aa.ads_matched_by_adset, 0) AS ads_matched_by_adset,
    COALESCE(aa.ads_matched_by_parse, 0) AS ads_matched_by_parse,
    COALESCE(aa.ads_unmatched, 0) AS ads_unmatched,

    ROUND(SAFE_DIVIDE(COALESCE(oa.revenue_L3, 0), NULLIF(aa.ads_spend_usd * fx.rate, 0)), 2) AS real_roas,
    ROUND(SAFE_DIVIDE(aa.ads_spend_usd * fx.rate, NULLIF(COALESCE(oa.total_orders, 0), 0)), 2) AS real_cpa,
    ROUND(SAFE_DIVIDE(COALESCE(oa.revenue_L1, 0), NULLIF(COALESCE(oa.total_orders, 0), 0)), 2) AS avg_order_value,
    ROUND(SAFE_DIVIDE(aa.ads_spend_usd, NULLIF(aa.impressions, 0)) * 1000, 2) AS cpm_usd,
    ROUND(SAFE_DIVIDE(aa.clicks, NULLIF(aa.impressions, 0)) * 100, 2) AS ctr_pct,
    ROUND(SAFE_DIVIDE(COALESCE(oa.total_orders, 0), NULLIF(aa.clicks, 0)) * 100, 2) AS cr_click_pct,
    ROUND(SAFE_DIVIDE(COALESCE(oa.success_orders, 0), NULLIF(COALESCE(oa.success_orders, 0) + COALESCE(oa.returned_orders, 0) + COALESCE(oa.cancelled_orders, 0), 0)) * 100, 1) AS delivery_rate_pct,
    ROUND(SAFE_DIVIDE(COALESCE(oa.returned_orders, 0), NULLIF(COALESCE(oa.total_orders, 0), 0)) * 100, 1) AS return_rate_pct,

    CASE
        WHEN COALESCE(aa.ads_spend_usd, 0) = 0 THEN '⚪ NO_ADS'
        WHEN SAFE_DIVIDE(aa.ads_spend_usd, NULLIF(aa.impressions, 0)) * 1000 > 15 THEN '🔴 CPM_HIGH'
        WHEN SAFE_DIVIDE(aa.clicks, NULLIF(aa.impressions, 0)) * 100 < 0.8 THEN '🟡 CTR_LOW'
        WHEN SAFE_DIVIDE(COALESCE(oa.total_orders, 0), NULLIF(aa.clicks, 0)) * 100 < 2 THEN '🟠 CR_LOW'
        WHEN SAFE_DIVIDE(COALESCE(oa.revenue_L3, 0), NULLIF(aa.ads_spend_usd * fx.rate, 0)) >= 3 THEN '🟢 SCALE'
        WHEN SAFE_DIVIDE(COALESCE(oa.revenue_L3, 0), NULLIF(aa.ads_spend_usd * fx.rate, 0)) >= 1.5 THEN '⚪ MONITOR'
        ELSE '🔴 KILL'
    END AS diagnosis

FROM order_agg oa
FULL OUTER JOIN ads_agg aa ON oa.marketer_id = aa.marketer_id AND oa.report_date = aa.report_date
LEFT JOIN order_cogs oc ON COALESCE(oa.report_date, aa.report_date) = oc.report_date
    AND COALESCE(oa.marketer_id, aa.marketer_id) = oc.marketer_id
LEFT JOIN mkter_names mn ON aa.marketer_id = mn.marketer_id
CROSS JOIN fx
CROSS JOIN fx_eur
CROSS JOIN ffm_costs fc
;
