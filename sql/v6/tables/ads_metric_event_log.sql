-- ═══════════════════════════════════════════════════════════════════
-- FAOS v6 — ads_metric_event_log
-- ═══════════════════════════════════════════════════════════════════
-- Purpose: Intraday metric snapshots for slope/gradient detection.
--          Tracks how key metrics change WITHIN a day across sync cycles.
--
-- Use case: "CTR was 1.2% at 9:00, dropped to 0.8% at 9:30"
--           → slope = -0.4 in 30 min → WARNING signal
--
-- ▸ RULE: Slope is a WARNING SIGNAL ONLY, never a sole Kill trigger.
--   Must persist across 2+ sync cycles AND align with MA7 trend.
--
-- Retention: 7 days (short-lived, high-frequency data)
-- Dataset: Replace {DATASET} with STRAMARK_Dataset / etc.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS `levelup-465304.{DATASET}.ads_metric_event_log` (
  -- ═══ IDENTITY ═══
  campaign_id STRING NOT NULL,
  campaign_name STRING,
  adset_id STRING,
  ad_id STRING,

  -- ═══ METRIC SNAPSHOT ═══
  metric_name STRING NOT NULL,               -- CTR | CPM | HOOK_RATE | SPEND | CPC | CPL
  metric_value FLOAT64 NOT NULL,
  metric_prev_value FLOAT64,                 -- previous sync cycle value
  metric_slope FLOAT64,                      -- (current - prev) / time_delta_hours
  slope_direction STRING,                    -- RISING | FALLING | STABLE

  -- ═══ CONTEXT ═══
  snapshot_time TIMESTAMP NOT NULL,
  sync_batch_id STRING,
  sync_tier STRING,                          -- HOT | WARM
  consecutive_slope_count INT64 DEFAULT 1,   -- how many consecutive syncs same direction

  -- ═══ METADATA ═══
  project_id STRING NOT NULL
)
PARTITION BY DATE(snapshot_time)
CLUSTER BY campaign_id, metric_name
OPTIONS (
  description = 'FAOS v6 — Intraday metric snapshots for slope detection (7-day retention)',
  require_partition_filter = true,
  partition_expiration_days = 7
);
