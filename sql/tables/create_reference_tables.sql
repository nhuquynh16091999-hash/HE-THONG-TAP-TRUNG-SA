-- ╔══════════════════════════════════════════════════════════════╗
-- ║  Reference & Transaction Tables — From Dev Architecture     ║
-- ║  Source of Truth: sql/tables/create_reference_tables.sql     ║
-- ╚══════════════════════════════════════════════════════════════╝
--
-- These 4 tables fill gaps identified from dev reference (tl.docx + lv.drawio).
-- They enable: accurate marketer attribution, adset-level analytics,
-- and product-level P&L via combo tracking.
--
-- DEPLOY: Replace {PROJECT} and {DATASET} with actual values.

-- ══════════════════════════════════════════
-- 1. page_marketer — Page ↔ Marketer assignment
-- ══════════════════════════════════════════
-- SOURCE: Manual config / Google Sheet / Poscake page API
-- SYNC: Weekly (pages rarely change)
-- KEY INSIGHT from tl.docx: "Marketer sẽ được tính doanh số dựa trên Fanpage mà họ quản lý"
CREATE TABLE IF NOT EXISTS `{PROJECT}.{DATASET}.page_marketer` (
  page_id STRING NOT NULL,            -- FB page_id (matches sale_order.page_id)
  page_name STRING,                   -- FB page name
  marketer_id STRING NOT NULL,        -- Maps to dim_marketer_mapping.marketer_id
  marketer_name STRING,               -- Human-readable name
  project_id STRING,                  -- Project scope
  assigned_date DATE,                 -- When assigned
  is_active BOOL DEFAULT TRUE,        -- Soft delete
  notes STRING
);

-- ══════════════════════════════════════════
-- 2. fb_adset_data — Adset-level daily spend
-- ══════════════════════════════════════════
-- SOURCE: Meta Marketing API (Graph API v21.0)
-- SYNC: Daily, delete-before-insert per date range
-- ENDPOINT: GET /{ad_account_id}/insights?level=adset
-- WHY: Orders match via adset_id (STRAMARK), we need spend at adset level for ROAS
CREATE TABLE IF NOT EXISTS `{PROJECT}.{DATASET}.fb_adset_data` (
  adset_id STRING NOT NULL,           -- FB adset_id (matches sale_order.adset_id)
  adset_name STRING,                  -- Adset name
  date STRING NOT NULL,               -- YYYY-MM-DD
  
  -- Spend & Performance
  spend FLOAT64,                      -- USD (FB always reports in account currency)
  impressions INT64,
  reach INT64,
  clicks INT64,
  
  -- Calculated metrics (from API or compute)
  cpm FLOAT64,                        -- Cost per 1000 impressions
  cpc FLOAT64,                        -- Cost per click
  ctr FLOAT64,                        -- Click-through rate %
  
  -- Conversions (pixel-based, may be inaccurate for COD)
  purchases INT64,
  purchase_value FLOAT64,
  messaging_conversations INT64,
  
  -- Hierarchy
  campaign_id STRING,                 -- Parent campaign
  campaign_name STRING,               -- Campaign name for reference
  account_id STRING,                  -- Ad account
  
  -- Metadata
  sync_time TIMESTAMP
);

-- ══════════════════════════════════════════
-- 3. sale_combo — Combo sold per order
-- ══════════════════════════════════════════
-- SOURCE: Poscake Order API (nested in order response)
-- SYNC: Together with sale_order sync
-- RULE from tl.docx: "1 đơn hàng chỉ có 1 loại combo duy nhất"
CREATE TABLE IF NOT EXISTS `{PROJECT}.{DATASET}.sale_combo` (
  order_id STRING NOT NULL,           -- Maps to sale_order.id
  combo_id STRING NOT NULL,           -- Poscake combo_id
  combo_custom_id STRING,             -- Custom ID (human-readable)
  combo_name STRING,                  -- Combo display name
  quantity INT64,                     -- How many of this combo in the order
  combo_value FLOAT64,                -- Price of combo (bani/cent - ÷100)
  shop_id STRING,                     -- Shop context
  currency_code STRING,               -- Currency (RON, USD, etc)
  sync_time TIMESTAMP
);

-- ══════════════════════════════════════════
-- 4. combo_items — Products inside a combo
-- ══════════════════════════════════════════
-- SOURCE: Poscake Combo API or Google Sheet config
-- SYNC: Weekly (combos rarely change)
-- RULE from tl.docx: "Việc combo đó sẽ tính doanh số cho sản phẩm nào sẽ theo config của dự án"
CREATE TABLE IF NOT EXISTS `{PROJECT}.{DATASET}.combo_items` (
  combo_id STRING NOT NULL,           -- Maps to sale_combo.combo_id / combo_list.combo_id
  product_template_id STRING,         -- Maps to product_template.id
  product_custom_id STRING,           -- Product SKU/custom_id
  product_name STRING,                -- Product display name
  quantity_in_combo INT64 DEFAULT 1,  -- How many of this product per combo
  is_revenue_product BOOL DEFAULT TRUE, -- Whether this product gets revenue attribution
  shop_id STRING,                     -- Shop context
  notes STRING
);
