-- vw_true_roas — AUUS1 (US + AU shops)
-- Mục đích: True ROAS từ POS orders, dùng cho CMO ETL (near-realtime)
-- Dataset: AUUS1_Dataset
-- Revenue đơn vị: USD (US giữ nguyên, AUD × 0.65 → USD)
-- POS price_divisor: 100 (cod=5000 → 50.00 USD/AUD)
-- Attribution: resolved_ad_id (p_utm_term → ad_id → adset fallback)
--   Pattern copy từ vw_fact_orders.sql lines 61-73
-- CMO ETL expects: campaign_id, ad_date, success_orders, attributed_revenue, ad_spend
-- Update frequency: realtime (VIEW — không cần ETL, luôn fresh)

CREATE OR REPLACE VIEW `levelup-465304.AUUS1_Dataset.vw_true_roas` AS

WITH
-- Bước 1: Resolve ad attribution từ orders
-- Ưu tiên: p_utm_term (nếu là số ≥10 chữ số) > ad_id > p_utm_medium (adset) > adset_id
orders_resolved AS (
    SELECT
        o.id                                                   AS order_id,
        DATE(o.inserted_at)                                    AS order_date,
        o.shop_label,
        o.status_category,
        -- Resolved ad_id: p_utm_term nếu là numeric ID, fallback về ad_id
        CASE
            WHEN o.p_utm_term IS NOT NULL
                 AND LENGTH(o.p_utm_term) > 10
                 AND REGEXP_CONTAINS(o.p_utm_term, r'^[0-9]+$')
            THEN o.p_utm_term
            WHEN o.ad_id IS NOT NULL AND TRIM(o.ad_id) != ''
            THEN o.ad_id
            ELSE NULL
        END                                                    AS resolved_ad_id,
        -- Resolved adset_id: p_utm_medium nếu là numeric ID, fallback về adset_id
        CASE
            WHEN o.p_utm_medium IS NOT NULL
                 AND LENGTH(o.p_utm_medium) > 10
                 AND REGEXP_CONTAINS(o.p_utm_medium, r'^[0-9]+$')
            THEN o.p_utm_medium
            WHEN o.adset_id IS NOT NULL AND TRIM(o.adset_id) != ''
            THEN o.adset_id
            ELSE NULL
        END                                                    AS resolved_adset_id,
        -- Revenue: quy về USD (chia 100 vì Poscake lưu minor units)
        CASE o.shop_label
            WHEN 'US' THEN o.cod / 100           -- USD giữ nguyên
            WHEN 'AU' THEN o.cod / 100 * 0.65    -- AUD → USD
            ELSE            o.cod / 100
        END                                                    AS revenue_usd
    FROM `levelup-465304.AUUS1_Dataset.sale_order` o
    WHERE o.inserted_at IS NOT NULL AND o.inserted_at != ''
),

-- Bước 2: Map ad_id → campaign_id từ lịch sử chạy ads
ad_to_campaign AS (
    SELECT
        CAST(ad_id AS STRING)       AS ad_id,
        ANY_VALUE(CAST(campaign_id AS STRING)) AS campaign_id
    FROM `levelup-465304.AUUS1_Dataset.fb_ads_data`
    GROUP BY ad_id
),
adset_to_campaign AS (
    SELECT
        CAST(adset_id AS STRING)    AS adset_id,
        ANY_VALUE(CAST(campaign_id AS STRING)) AS campaign_id
    FROM (
        SELECT CAST(adset_id AS STRING) AS adset_id, CAST(campaign_id AS STRING) AS campaign_id
        FROM `levelup-465304.AUUS1_Dataset.fb_ads_data`
        UNION ALL
        SELECT CAST(adset_id AS STRING) AS adset_id, CAST(campaign_id AS STRING) AS campaign_id
        FROM `levelup-465304.AUUS1_Dataset.fb_adset_data`
    )
    GROUP BY adset_id
),

-- Bước 3: Join orders → campaign
orders_with_campaign AS (
    SELECT
        o.order_id,
        o.order_date,
        o.status_category,
        o.revenue_usd,
        COALESCE(ac.campaign_id, asc2.campaign_id) AS campaign_id
    FROM orders_resolved o
    LEFT JOIN ad_to_campaign    ac   ON o.resolved_ad_id   = ac.ad_id
    LEFT JOIN adset_to_campaign asc2 ON o.resolved_adset_id = asc2.adset_id
),

-- Bước 4: Daily spend per campaign (để tính true_roas)
ads_daily_spend AS (
    SELECT
        CAST(campaign_id AS STRING) AS campaign_id,
        DATE(date)                  AS ad_date,
        SUM(spend)                  AS ad_spend
    FROM `levelup-465304.AUUS1_Dataset.fb_ads_data`
    GROUP BY 1, 2
)

-- Kết quả cuối: campaign × order_date aggregation
SELECT
    o.campaign_id                                              AS campaign_id,
    o.order_date                                               AS ad_date,
    COALESCE(s.ad_spend, 0)                                    AS ad_spend,
    COUNT(o.order_id)                                          AS total_orders,
    COUNTIF(o.status_category = 'GIAO_THANH_CONG')            AS success_orders,
    COALESCE(
        SUM(CASE WHEN o.status_category = 'GIAO_THANH_CONG'
                 THEN o.revenue_usd ELSE 0 END), 0
    )                                                          AS attributed_revenue,
    SAFE_DIVIDE(
        COALESCE(
            SUM(CASE WHEN o.status_category = 'GIAO_THANH_CONG'
                     THEN o.revenue_usd ELSE 0 END), 0
        ),
        NULLIF(COALESCE(s.ad_spend, 0), 0)
    )                                                          AS true_roas
FROM orders_with_campaign o
LEFT JOIN ads_daily_spend s
    ON  o.campaign_id = s.campaign_id
    AND o.order_date  = s.ad_date
WHERE o.campaign_id IS NOT NULL
GROUP BY 1, 2, 3;
