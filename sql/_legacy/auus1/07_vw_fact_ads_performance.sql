-- ═══════════════════════════════════════════════════
-- vw_fact_ads_performance — AUUS1
-- Source of Truth: sql/auus1/07_vw_fact_ads_performance.sql
-- ═══════════════════════════════════════════════════
-- Updated 2026-02-21: Added clicks, purchases, purchase_value,
-- ctr, cpc, frequency, ROAS, CPA from new fb_ads_data columns
-- Campaign format: Market/Marketer/Product/AccountID/PageName/Date[/extra]
-- ═══════════════════════════════════════════════════

CREATE OR REPLACE VIEW `levelup-465304.AUUS1_Dataset.vw_fact_ads_performance` AS
WITH fx AS (
    SELECT rate FROM `levelup-465304.AUUS1_Dataset.cost_exchange_rates`
    WHERE from_currency = 'USD' AND to_currency = 'VND'
    ORDER BY effective_date DESC LIMIT 1
),
ads AS (
    SELECT
        CAST(a.ad_id AS STRING) AS ad_id,
        CAST(a.ad_name AS STRING) AS ad_name,
        CAST(a.adset_id AS STRING) AS adset_id,
        CAST(a.campaign_id AS STRING) AS campaign_id,
        CAST(a.campaign_name AS STRING) AS campaign_name,
        CAST(a.account_id AS STRING) AS account_id,
        a.date AS report_date,
        -- ⚠️ act_773109749037011 bills in USD → convert to VND; all others are VND accounts
        CASE
            WHEN CAST(a.account_id AS STRING) IN ('773109749037011')
            THEN CAST(a.spend AS FLOAT64) * fx.rate   -- USD × VND rate = VND
            ELSE CAST(a.spend AS FLOAT64)              -- Already VND
        END AS spend_vnd,
        COALESCE(CAST(a.impressions AS INT64), 0) AS impressions,
        COALESCE(CAST(a.reach AS INT64), 0) AS reach,
        COALESCE(CAST(a.clicks AS INT64), 0) AS clicks,
        COALESCE(CAST(a.purchases AS INT64), 0) AS purchases,
        COALESCE(CAST(a.purchase_value AS FLOAT64), 0) AS purchase_value,
        COALESCE(CAST(a.messaging_conversations_started AS INT64), 0) AS messages,
        COALESCE(CAST(a.frequency AS FLOAT64), 0) AS frequency,
        COALESCE(CAST(a.cpc AS FLOAT64), 0) AS cpc,
        COALESCE(CAST(a.ctr AS FLOAT64), 0) AS ctr_raw,
        'VND' AS ads_currency,
        -- Campaign parsing: supports 2 formats:
        --   New: PIA_MKTER_MARKET_PRODUCT_TYPE  (underscore, e.g. PIA_THANHNT_AU_131_ABO)
        --   Old: Market/Marketer/Product/...    (slash, e.g. USA/Thắng/Product/...)
        CASE
            WHEN CAST(a.campaign_name AS STRING) LIKE 'PIA_%'
            THEN TRIM(SPLIT(CAST(a.campaign_name AS STRING), '_')[SAFE_OFFSET(3)])
            ELSE TRIM(SPLIT(CAST(a.campaign_name AS STRING), '/')[SAFE_OFFSET(2)])
        END AS campaign_product_code,
        CASE
            WHEN CAST(a.campaign_name AS STRING) LIKE 'PIA_%'
            THEN UPPER(TRIM(SPLIT(CAST(a.campaign_name AS STRING), '_')[SAFE_OFFSET(2)]))
            WHEN UPPER(TRIM(SPLIT(CAST(a.campaign_name AS STRING), '/')[SAFE_OFFSET(0)])) IN ('AUS','AUSTRALIA') THEN 'AU'
            WHEN UPPER(TRIM(SPLIT(CAST(a.campaign_name AS STRING), '/')[SAFE_OFFSET(0)])) = 'US' THEN 'US'
            ELSE TRIM(SPLIT(CAST(a.campaign_name AS STRING), '/')[SAFE_OFFSET(0)])
        END AS campaign_market,
        TRIM(SPLIT(CAST(a.campaign_name AS STRING), '/')[SAFE_OFFSET(5)]) AS campaign_type,
        TRIM(SPLIT(CAST(a.campaign_name AS STRING), '/')[SAFE_OFFSET(4)]) AS campaign_brand,
        -- Marketer code: NEW PIA_MKTER_... format uses '_' at index 1; old uses '/' at index 1
        CASE
            WHEN CAST(a.campaign_name AS STRING) LIKE 'PIA_%'
            THEN TRIM(SPLIT(CAST(a.campaign_name AS STRING), '_')[SAFE_OFFSET(1)])
            ELSE TRIM(SPLIT(CAST(a.campaign_name AS STRING), '/')[SAFE_OFFSET(1)])
        END AS campaign_mkter_code
    FROM `levelup-465304.AUUS1_Dataset.fb_ads_data` a
    CROSS JOIN fx
)
SELECT
    a.ad_id, a.ad_name, a.adset_id, a.campaign_id, a.campaign_name,
    a.account_id, a.report_date,
    ROUND(a.spend_vnd / fx.rate, 2) AS spend_usd,
    ROUND(a.spend_vnd, 0) AS spend_ron,
    a.impressions, a.reach, a.clicks,
    a.purchases, a.purchase_value, a.messages,
    a.frequency, a.cpc, a.ctr_raw,
    a.ads_currency,
    a.campaign_product_code, a.campaign_market,
    a.campaign_type, a.campaign_brand, a.campaign_mkter_code,
    -- Calculated metrics
    ROUND(SAFE_DIVIDE(a.spend_vnd / fx.rate, NULLIF(a.impressions, 0)) * 1000, 2) AS cpm_usd,
    ROUND(SAFE_DIVIDE(a.clicks, NULLIF(a.impressions, 0)) * 100, 2) AS ctr_pct,
    ROUND(SAFE_DIVIDE(a.messages, NULLIF(a.impressions, 0)) * 100, 2) AS msg_rate_pct,
    ROUND(SAFE_DIVIDE(a.purchase_value, NULLIF(a.spend_vnd / fx.rate, 0)), 2) AS roas,
    ROUND(SAFE_DIVIDE(a.spend_vnd / fx.rate, NULLIF(a.purchases, 0)), 2) AS cpa_usd
FROM ads a
CROSS JOIN fx
;

