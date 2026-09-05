-- ═══════════════════════════════════════════════════════════════════
-- FAOS v6 — fact_ads_optimization
-- ═══════════════════════════════════════════════════════════════════
-- Purpose: Dedicated table for Ads Optimization Intelligence module.
--          Stores enriched ad-level data with video metrics, creative
--          metadata, targeting context, and real revenue mapping.
--
-- Grain: ad_id × report_date (one row per ad per day)
-- Sync:  Smart Sync — Hot(30m)/Warm(3-6h)/Cold(daily)/Once(creative)
-- Source: Meta Marketing API + BigQuery sale_order JOIN
--
-- ▸ NOT A REPLACEMENT for fb_ads_data — this is a SEPARATE table
--   for the optimization module only.
--
-- Dataset: Replace {DATASET} with STRAMARK_Dataset / AUUS1_Dataset / etc.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS `levelup-465304.{DATASET}.fact_ads_optimization` (
  -- ═══ IDENTITY (grain: ad_id × report_date) ═══
  ad_id STRING NOT NULL,
  ad_name STRING,
  adset_id STRING,
  adset_name STRING,
  campaign_id STRING NOT NULL,
  campaign_name STRING,
  account_id STRING,
  report_date DATE NOT NULL,

  -- ═══ CORE METRICS — Hot Tier (sync mỗi 30 phút) ═══
  spend FLOAT64 DEFAULT 0,
  impressions INT64 DEFAULT 0,
  reach INT64 DEFAULT 0,
  clicks INT64 DEFAULT 0,
  cpm FLOAT64 DEFAULT 0,
  cpc FLOAT64 DEFAULT 0,
  ctr FLOAT64 DEFAULT 0,
  frequency FLOAT64 DEFAULT 0,

  -- ═══ CONVERSION SIGNALS — Warm Tier (sync mỗi 3-6 giờ) ═══
  leads INT64 DEFAULT 0,
  messages INT64 DEFAULT 0,
  add_to_cart INT64 DEFAULT 0,
  purchases INT64 DEFAULT 0,
  purchase_value FLOAT64 DEFAULT 0,

  -- ═══ VIDEO METRICS — Warm Tier (sync mỗi 3-6 giờ) ═══
  video_views INT64 DEFAULT 0,
  video_views_p25 INT64 DEFAULT 0,          -- viewed 25% of video
  video_views_p50 INT64 DEFAULT 0,          -- viewed 50%
  video_views_p75 INT64 DEFAULT 0,          -- viewed 75%
  video_views_p100 INT64 DEFAULT 0,         -- viewed 100% (completed)
  video_avg_play_time FLOAT64 DEFAULT 0,    -- average seconds watched

  -- ═══ CREATIVE METADATA — Once Tier (sync 1 lần per new ad_id) ═══
  creative_type STRING,                      -- VIDEO | IMAGE | CAROUSEL | COLLECTION
  creative_body STRING,                      -- ad text/copy
  creative_title STRING,                     -- headline
  creative_thumbnail_url STRING,             -- image/thumbnail URL
  call_to_action STRING,                     -- SHOP_NOW | LEARN_MORE | SEND_MESSAGE | ...

  -- ═══ TARGETING CONTEXT — Once Tier (from adset config) ═══
  targeting_country STRING,                  -- RO | BG | HU | ...
  targeting_age_min INT64,
  targeting_age_max INT64,
  targeting_gender STRING,                   -- ALL | MALE | FEMALE

  -- ═══ REVENUE MAPPING — Cold Tier (sync daily, JOIN sale_order) ═══
  real_orders INT64 DEFAULT 0,               -- POS orders matched by ad_id
  confirmed_orders INT64 DEFAULT 0,          -- delivered/success orders
  return_orders INT64 DEFAULT 0,             -- returned/cancelled orders
  real_revenue FLOAT64 DEFAULT 0,            -- provisional revenue (POS total)
  confirmed_revenue FLOAT64 DEFAULT 0,       -- confirmed revenue (delivered only)
  return_rate FLOAT64 DEFAULT 0,             -- return_orders / real_orders

  -- ═══ COMPUTED SIGNALS (calculated during sync) ═══
  hook_rate FLOAT64,                         -- video_views_p25 / impressions
  hold_rate FLOAT64,                         -- video_views_p75 / impressions
  completion_rate FLOAT64,                   -- video_views_p100 / video_views
  cost_per_lead FLOAT64,                     -- spend / leads
  cost_per_order FLOAT64,                    -- spend / real_orders
  real_roas FLOAT64,                         -- real_revenue / spend
  confirmed_roas FLOAT64,                    -- confirmed_revenue / spend

  -- ═══ CAMPAIGN CONTEXT ═══
  campaign_age_days INT64 DEFAULT 0,         -- days since campaign first active
  campaign_status STRING DEFAULT 'ACTIVE',   -- ACTIVE | PAUSED | DELETED

  -- ═══ METADATA ═══
  sync_tier STRING,                          -- HOT | WARM | COLD | ONCE
  sync_batch_id STRING,                      -- batch identifier for this sync run
  sync_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP(),
  project_id STRING NOT NULL
)
PARTITION BY report_date
CLUSTER BY campaign_id, project_id
OPTIONS (
  description = 'FAOS v6 Ads Optimization Intelligence — enriched ad-level data',
  require_partition_filter = true,
  partition_expiration_days = 90
);
