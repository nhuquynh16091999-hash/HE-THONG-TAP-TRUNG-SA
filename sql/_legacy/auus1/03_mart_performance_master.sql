-- ═══════════════════════════════════════════════════
-- mart_performance_master v1 — AUUS1
-- Source of Truth: sql/auus1/03_mart_performance_master.sql
-- ═══════════════════════════════════════════════════
-- AUUS1 fb_ads_data schema differences from Stramark:
--   - No 'clicks' column (use 0 as placeholder)
--   - 'messages' → 'messaging_conversation_started'
--   - 'spend', 'ad_id', 'adset_id', 'campaign_id' are INTEGER (not STRING/FLOAT)
--   - Exchange rate: USD → VND (not USD → RON)
--   - act_773109749037011: USD account → spend must be × fx.rate to convert to VND
-- ═══════════════════════════════════════════════════

CREATE OR REPLACE VIEW `levelup-465304.AUUS1_Dataset.mart_performance_master` AS
-- fx needed: act_773109749037011 bills in USD, must convert to VND
WITH
fx AS (
    SELECT rate FROM `levelup-465304.AUUS1_Dataset.cost_exchange_rates`
    WHERE from_currency = 'USD' AND to_currency = 'VND'
    ORDER BY effective_date DESC LIMIT 1
),
ad_marketer_map AS (
    SELECT
        resolved_ad_id AS ad_id,
        APPROX_TOP_COUNT(marketer_id, 1)[OFFSET(0)].value AS marketer_id
    FROM `levelup-465304.AUUS1_Dataset.vw_fact_orders`
    WHERE resolved_ad_id IS NOT NULL
      AND marketer_id IS NOT NULL
      AND marketer_id != 'UNKNOWN'
    GROUP BY 1
),
adset_marketer_map AS (
    SELECT
        resolved_adset_id AS adset_id,
        APPROX_TOP_COUNT(marketer_id, 1)[OFFSET(0)].value AS marketer_id
    FROM `levelup-465304.AUUS1_Dataset.vw_fact_orders`
    WHERE resolved_adset_id IS NOT NULL
      AND marketer_id IS NOT NULL
      AND marketer_id != 'UNKNOWN'
    GROUP BY 1
),

mkter_lookup AS (
    SELECT marketer_id, ANY_VALUE(campaign_code) AS campaign_code
    FROM `levelup-465304.AUUS1_Dataset.dim_marketer_mapping`
    GROUP BY marketer_id
),

ads_enriched AS (
    SELECT
        CAST(a.date AS STRING) AS report_date,
        CAST(a.ad_id AS STRING) AS ad_id,
        CAST(a.adset_id AS STRING) AS adset_id,
        CAST(a.campaign_name AS STRING) AS campaign_name,
        -- ⚠️ act_773109749037011 bills in USD → convert to VND; all others are VND accounts
        CASE
            WHEN CAST(a.account_id AS STRING) IN ('773109749037011')
            THEN CAST(a.spend AS FLOAT64) * fx.rate   -- USD × VND rate = VND
            ELSE CAST(a.spend AS FLOAT64)              -- Already VND
        END AS spend_vnd,
        COALESCE(CAST(a.impressions AS INT64), 0) AS impressions,
        COALESCE(CAST(a.reach AS INT64), 0) AS reach,
        0 AS clicks,  -- AUUS1 fb_ads_data has no clicks column
        COALESCE(CAST(a.messaging_conversations_started AS INT64), 0) AS messages,
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
    FROM `levelup-465304.AUUS1_Dataset.fb_ads_data` a
    CROSS JOIN fx
    LEFT JOIN ad_marketer_map am ON CAST(a.ad_id AS STRING) = am.ad_id
    LEFT JOIN adset_marketer_map asm ON CAST(a.adset_id AS STRING) = asm.adset_id
    LEFT JOIN (
        SELECT marketer_id, LOWER(campaign_code) AS campaign_code FROM (
            SELECT marketer_id, campaign_code FROM `levelup-465304.AUUS1_Dataset.dim_marketer_mapping`
            UNION ALL
            -- Add short name mappings from campaign format: Market/Marketer/...
            SELECT 'THANHNT' AS marketer_id, 'Thành' AS campaign_code
            UNION ALL SELECT 'MANHDS', 'Mạnh'
            UNION ALL SELECT 'THANGNH', 'Thắng'
            UNION ALL SELECT 'KINHBN', 'Kính'
            UNION ALL SELECT 'CHINHTV', 'CHINHTV'
        ) GROUP BY 1, 2
    ) ml
        ON LOWER(TRIM(SPLIT(REPLACE(CAST(a.campaign_name AS STRING), '_', '/'), '/')[SAFE_OFFSET(1)])) = ml.campaign_code
),

ads_agg AS (
    SELECT
        SAFE.PARSE_DATE('%Y-%m-%d', report_date) AS report_date,
        marketer_id,
        ROUND(SUM(spend_vnd), 0) AS ads_spend_vnd,
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
        ROUND(SUM(o.revenue_L1_lead), 0) AS revenue_L1,
        ROUND(SUM(o.revenue_L2_shipped), 0) AS revenue_L2,
        ROUND(SUM(o.revenue_L3_success), 0) AS revenue_L3,
        ROUND(SUM(o.revenue_L4_collected), 0) AS revenue_L4,
        COUNTIF(o.attribution_type IN ('AD_MATCH','ADSET_MATCH')) AS attributed_orders
    FROM `levelup-465304.AUUS1_Dataset.vw_fact_orders` o
    GROUP BY 1, 2
),
order_cogs AS (
    -- COGS + Shipping = $15 USD / đơn (flat rate) × tỷ giá USD→VND
    -- Chỉ tính cho đơn đã vào pipeline (L2: status 8,2,3,16,4,5)
    SELECT o.order_date AS report_date, o.marketer_id,
        COUNTIF(o.status_code IN (8,2,3,16,4,5)) AS shipped_orders,
        ROUND(COUNTIF(o.status_code IN (8,2,3,16,4,5)) * 15 * o2.rate, 0) AS total_cogs_shipping
    FROM `levelup-465304.AUUS1_Dataset.vw_fact_orders` o
    CROSS JOIN (
        SELECT rate FROM `levelup-465304.AUUS1_Dataset.cost_exchange_rates`
        WHERE from_currency = 'USD' AND to_currency = 'VND'
        ORDER BY effective_date DESC LIMIT 1
    ) o2
    GROUP BY 1, 2, o2.rate
)

SELECT
    -- Use COALESCE: ads_agg may have rows without order_agg (UNMATCHED marketer ads)
    COALESCE(oa.report_date, aa.report_date) AS report_date,
    COALESCE(oa.marketer_id, aa.marketer_id) AS marketer_id,
    COALESCE(oa.marketer_name, aa.marketer_id) AS marketer_name,
    COALESCE(oa.total_orders, 0) AS total_orders,
    COALESCE(oa.success_orders, 0) AS success_orders,
    COALESCE(oa.returned_orders, 0) AS returned_orders,
    COALESCE(oa.cancelled_orders, 0) AS cancelled_orders,
    COALESCE(oa.pending_orders, 0) AS pending_orders,
    COALESCE(oa.attributed_orders, 0) AS attributed_orders,

    ROUND(COALESCE(oa.revenue_L1, 0), 0) AS revenue_lead,
    ROUND(COALESCE(oa.revenue_L2, 0), 0) AS revenue_shipped,
    ROUND(COALESCE(oa.revenue_L3, 0), 0) AS revenue_success,
    -- Dashboard compatibility aliases
    ROUND(COALESCE(oa.revenue_L3, 0), 0) AS delivered_revenue,
    ROUND(COALESCE(oa.revenue_L1, 0), 0) AS revenue_total,
    ROUND(COALESCE(oa.revenue_L4, 0), 0) AS revenue_collected,
    ROUND(COALESCE(oa.revenue_L4, 0), 0) AS revenue_cod_collected,

    ROUND(COALESCE(aa.ads_spend_vnd, 0), 0) AS ads_spend_vnd,
    ROUND(COALESCE(aa.ads_spend_vnd, 0), 0) AS ads_spend_ron,
    ROUND(COALESCE(oc.total_cogs_shipping, 0), 0) AS cogs,
    0 AS shipping_cost,
    0 AS partner_fee,
    0 AS return_cost,

    ROUND(COALESCE(oa.revenue_L3, 0) - COALESCE(aa.ads_spend_vnd, 0)
          - COALESCE(oc.total_cogs_shipping, 0), 0) AS net_profit,

    -- ROAS metrics
    ROUND(SAFE_DIVIDE(COALESCE(oa.revenue_L2, 0), NULLIF(aa.ads_spend_vnd, 0)), 2) AS roas_shipped,
    ROUND(SAFE_DIVIDE(COALESCE(oa.revenue_L3, 0), NULLIF(aa.ads_spend_vnd, 0)), 2) AS roas_success,
    ROUND(SAFE_DIVIDE(COALESCE(oa.revenue_L2, 0) * 0.65, NULLIF(aa.ads_spend_vnd, 0)), 2) AS roas_estimated,

    COALESCE(aa.impressions, 0) AS impressions,
    COALESCE(aa.reach, 0) AS reach,
    COALESCE(aa.clicks, 0) AS clicks,
    COALESCE(aa.messages, 0) AS messages,

    COALESCE(aa.ads_matched_by_ad, 0) AS ads_matched_by_ad,
    COALESCE(aa.ads_matched_by_adset, 0) AS ads_matched_by_adset,
    COALESCE(aa.ads_matched_by_parse, 0) AS ads_matched_by_parse,
    COALESCE(aa.ads_unmatched, 0) AS ads_unmatched,

    ROUND(SAFE_DIVIDE(COALESCE(oa.revenue_L1, 0), NULLIF(COALESCE(oa.total_orders, 0), 0)), 0) AS avg_order_value,
    ROUND(SAFE_DIVIDE(aa.ads_spend_vnd, NULLIF(aa.impressions, 0)) * 1000, 0) AS cpm,
    ROUND(SAFE_DIVIDE(aa.clicks, NULLIF(aa.impressions, 0)) * 100, 2) AS ctr_pct,
    ROUND(SAFE_DIVIDE(COALESCE(oa.total_orders, 0), NULLIF(aa.clicks, 0)) * 100, 2) AS cr_click_pct,
    ROUND(SAFE_DIVIDE(COALESCE(oa.success_orders, 0), NULLIF(COALESCE(oa.success_orders, 0) + COALESCE(oa.returned_orders, 0) + COALESCE(oa.cancelled_orders, 0), 0)) * 100, 1) AS delivery_rate_pct,
    ROUND(SAFE_DIVIDE(COALESCE(oa.returned_orders, 0), NULLIF(COALESCE(oa.total_orders, 0), 0)) * 100, 1) AS return_rate_pct,

    CASE
        WHEN COALESCE(aa.ads_spend_vnd, 0) = 0 THEN '⚪ NO_ADS'
        WHEN SAFE_DIVIDE(COALESCE(oa.revenue_L2, 0), NULLIF(aa.ads_spend_vnd, 0)) >= 3 THEN '🟢 SCALE'
        WHEN SAFE_DIVIDE(COALESCE(oa.revenue_L2, 0), NULLIF(aa.ads_spend_vnd, 0)) >= 1.5 THEN '⚪ MONITOR'
        ELSE '🔴 KILL'
    END AS diagnosis

-- ⚠️ FULL OUTER JOIN: includes ads with UNMATCHED marketer (no order attribution)
-- ensures total ads_spend in mart = total ads_spend in fb_ads_data
FROM order_agg oa
FULL OUTER JOIN ads_agg aa ON oa.marketer_id = aa.marketer_id AND oa.report_date = aa.report_date
LEFT JOIN order_cogs oc ON COALESCE(oa.report_date, aa.report_date) = oc.report_date
    AND COALESCE(oa.marketer_id, aa.marketer_id) = oc.marketer_id
;
