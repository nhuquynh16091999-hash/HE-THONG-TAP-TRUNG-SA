-- ╔══════════════════════════════════════════════════════════════╗
-- ║  Staging Tables — Per-Project Architecture                  ║
-- ║  Pattern: n8n → staging_* → MERGE INTO main table           ║
-- ║  Source of Truth: sql/tables/create_staging_tables.sql       ║
-- ╚══════════════════════════════════════════════════════════════╝
-- 
-- WHY: Staging pattern eliminates duplicate data from WRITE_APPEND.
-- Instead of appending raw data directly to sale_order (causing 8x duplication),
-- n8n writes to staging_sale_order, then merge_staging_orders.sql runs
-- DELETE-INSERT to keep the main table clean.
--
-- DEPLOY: Replace {PROJECT} and {DATASET} with actual values.
-- Example: levelup-465304.STRAMARK_Dataset

-- ══════════════════════════════════════════
-- 1. staging_sale_order — Receives raw API data from n8n
-- ══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS `{PROJECT}.{DATASET}.staging_sale_order` (
  -- Identity
  id STRING,
  system_id INT64,
  shop_id STRING,
  shop_name STRING,
  project_id STRING,

  -- Status
  status INT64,
  status_name STRING,
  sub_status STRING,

  -- Financials: Revenue (bani/cent — divide by 100 for display)
  cod FLOAT64,
  prepaid FLOAT64,
  total_price FLOAT64,
  total_price_after_sub_discount FLOAT64,
  total_discount FLOAT64,

  -- Financials: Costs
  shipping_fee FLOAT64,
  partner_fee FLOAT64,
  return_fee FLOAT64,
  fee_marketplace FLOAT64,
  surcharge FLOAT64,
  tax FLOAT64,
  customer_pay_fee FLOAT64,

  -- Financials: Payment Methods
  cash FLOAT64,
  transfer_money FLOAT64,
  charged_by_card FLOAT64,
  charged_by_momo FLOAT64,
  charged_by_qrpay FLOAT64,
  money_to_collect FLOAT64,
  prepaid_by_point FLOAT64,
  buyer_total_amount FLOAT64,

  -- Quantities
  total_quantity INT64,
  items_length INT64,

  -- Customer
  bill_full_name STRING,
  bill_phone_number STRING,
  bill_email STRING,
  customer_id STRING,
  customer_name STRING,

  -- Shipping
  shipping_address STRING,
  shipping_province STRING,
  shipping_district STRING,

  -- Attribution: Marketer / Seller
  marketer STRING,
  pke_mkter STRING,
  assigning_seller_id STRING,
  assigning_care_id STRING,
  creator STRING,
  account_name STRING,

  -- Attribution: Ads
  ad_id STRING,
  adset_id STRING,
  ads_source STRING,
  p_utm_source STRING,
  p_utm_campaign STRING,
  p_utm_medium STRING,
  p_utm_content STRING,
  p_utm_term STRING,
  p_utm_id STRING,

  -- Attribution: Source
  order_sources_name STRING,
  page_id STRING,
  conversation_id STRING,
  post_id STRING,
  is_livestream BOOL,
  is_live_shopping BOOL,

  -- Fulfillment
  partner STRING,
  tracking_link STRING,
  warehouse_id STRING,
  order_currency STRING,
  is_exchange_order BOOL,
  is_free_shipping BOOL,

  -- Timestamps
  inserted_at STRING,
  updated_at STRING,
  time_send_partner STRING,
  estimate_delivery_date STRING,

  -- Metadata
  note STRING,
  tags STRING,
  order_link STRING,
  sync_time TIMESTAMP
);

-- ══════════════════════════════════════════
-- 2. staging_order_items — Receives raw item data from n8n
-- ══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS `{PROJECT}.{DATASET}.staging_order_items` (
  -- Identity
  item_id STRING,
  order_id STRING,
  order_system_id INT64,
  shop_id STRING,
  shop_name STRING,
  project_id STRING,

  -- Product
  product_id STRING,
  variation_id STRING,
  product_name STRING,
  variation_name STRING,
  barcode STRING,

  -- Quantities
  quantity INT64,
  return_quantity INT64,
  returned_count INT64,
  returning_quantity INT64,

  -- Pricing (bani/cent)
  retail_price FLOAT64,
  discount_each_product FLOAT64,
  total_discount FLOAT64,
  same_price_discount FLOAT64,
  avg_imported_price FLOAT64,

  -- Flags
  is_bonus_product BOOL,
  is_composite BOOL,
  is_wholesale BOOL,

  -- Timestamps
  order_inserted_at STRING,
  sync_time TIMESTAMP
);
