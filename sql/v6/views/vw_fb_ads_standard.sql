-- ============================================================
-- vw_fb_ads_standard — Unified ads adapter view
-- ============================================================
-- Purpose: Standardize fb_ads_data schema across all datasets
-- Each dataset has slightly different column names/types.
-- This view outputs IDENTICAL columns regardless of source.
-- 
-- Usage: All NEW views should read from vw_fb_ads_standard
--        instead of fb_ads_data directly.
-- ============================================================
-- NOTE: This file is a TEMPLATE. Deploy script replaces
-- {DATASET} AND selects the correct column mapping per dataset.
-- ============================================================

-- === STRAMARK / T1 variant (columns already standard) ===
-- Used for: STRAMARK_Dataset, T1_Dataset

CREATE OR REPLACE VIEW `levelup-465304.{DATASET}.vw_fb_ads_standard` AS
SELECT
    ad_id,
    ad_name,
    adset_id,
    adset_name,
    campaign_id,
    campaign_name,
    account_id,
    CAST(date AS DATE)                                  AS date,
    COALESCE(CAST(spend AS FLOAT64), 0)                 AS spend,
    COALESCE(CAST(impressions AS INT64), 0)              AS impressions,
    COALESCE(CAST(reach AS INT64), 0)                    AS reach,
    COALESCE(CAST(clicks AS INT64), 0)                   AS clicks,
    COALESCE(CAST(cpm AS FLOAT64), 0)                    AS cpm,
    COALESCE(CAST(cpc AS FLOAT64), 0)                    AS cpc,
    COALESCE(CAST(ctr AS FLOAT64), 0)                    AS ctr,
    COALESCE(CAST(frequency AS FLOAT64), 0)              AS frequency,
    COALESCE(CAST(purchases AS INT64), 0)                AS purchases,
    0.0                                                  AS purchase_value,
    COALESCE(CAST(leads AS FLOAT64), 0)                  AS leads,
    COALESCE(CAST(messaging_conversations_started AS INT64), 0)
                                                         AS messaging_conversations_started,
    COALESCE(CAST(add_to_cart AS INT64), 0)               AS add_to_cart,
    sync_time
FROM `levelup-465304.{DATASET}.fb_ads_data`;
