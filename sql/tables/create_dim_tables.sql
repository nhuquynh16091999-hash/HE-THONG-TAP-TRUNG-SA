-- ╔══════════════════════════════════════════════════════╗
-- ║  Dimension Tables — Per-Project Architecture         ║
-- ║  Deploy to Zen8_Dataset (shared reference)           ║
-- ╚══════════════════════════════════════════════════════╝

-- ══════════════════════════════════════════
-- 1. dim_shop_project — Shop → Project mapping
-- ══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS `{PROJECT}.{DATASET}.dim_shop_project` (
  shop_id STRING NOT NULL,
  shop_name STRING,
  project_id STRING NOT NULL,
  project_name STRING,
  market_code STRING,
  market_name STRING,
  currency STRING,
  currency_divisor INT64 DEFAULT 1,
  dataset_name STRING,
  pos_type STRING DEFAULT 'poscake',
  ads_match_type STRING DEFAULT 'ad_id',
  is_active BOOL DEFAULT TRUE,
  notes STRING
);

-- ══════════════════════════════════════════
-- 2. dim_status_mapping — Unified status groups
-- ══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS `{PROJECT}.{DATASET}.dim_status_mapping` (
  status_code INT64 NOT NULL,
  status_name STRING,
  status_group STRING NOT NULL,
  display_name STRING,
  is_final BOOL DEFAULT FALSE,
  revenue_impact STRING,
  sort_order INT64
);

-- ══════════════════════════════════════════
-- 3. dim_marketer — Unified marketer registry
-- ══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS `{PROJECT}.{DATASET}.dim_marketer` (
  marketer_id STRING NOT NULL,
  marketer_name STRING,
  project_id STRING,
  role STRING,
  team STRING,
  is_active BOOL DEFAULT TRUE
);
