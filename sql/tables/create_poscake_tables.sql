-- Poscake Extended Schema: 5 tables per project
-- Usage: Replace {PROJECT} and {DATASET} before running

-- ══════════════════════════════════════════
-- 1. sale_order — Full order data (40+ fields)
-- ══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS `{PROJECT}.{DATASET}.sale_order` (
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

  -- Financials: Revenue
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
  ad_id STRING,                        -- FB ad_id (Mess ads, from Poscake native)
  adset_id STRING,                     -- FB adset_id (Web conversion, from UTM params)
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
-- 2. order_items — Line items with COGS
-- ══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS `{PROJECT}.{DATASET}.order_items` (
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

  -- Pricing
  retail_price FLOAT64,
  discount_each_product FLOAT64,
  total_discount FLOAT64,
  same_price_discount FLOAT64,
  avg_imported_price FLOAT64,        -- COGS per unit

  -- Flags
  is_bonus_product BOOL,
  is_composite BOOL,
  is_wholesale BOOL,

  -- Timestamps
  order_inserted_at STRING,
  sync_time TIMESTAMP
);

-- ══════════════════════════════════════════
-- 3. product_template — Products (expanded)
-- ══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS `{PROJECT}.{DATASET}.product_template` (
  id STRING,
  shop_id STRING,
  shop_name STRING,
  project_id STRING,
  custom_id STRING,
  display_id INT64,
  name STRING,
  type STRING,
  image STRING,
  note_product STRING,
  categories STRING,
  tags STRING,
  is_published BOOL,
  is_sell_negative BOOL,
  inserted_at STRING,
  sync_time TIMESTAMP
);

-- ══════════════════════════════════════════
-- 4. product_variations — Variation detail
-- ══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS `{PROJECT}.{DATASET}.product_variations` (
  id STRING,
  product_id STRING,
  shop_id STRING,
  shop_name STRING,
  project_id STRING,
  display_id STRING,
  barcode STRING,
  retail_price FLOAT64,
  retail_price_after_discount FLOAT64,
  average_imported_price FLOAT64,     -- COGS
  last_imported_price FLOAT64,
  price_at_counter FLOAT64,
  remain_quantity INT64,
  weight FLOAT64,
  is_hidden BOOL,
  is_locked BOOL,
  is_composite BOOL,
  inserted_at STRING,
  sync_time TIMESTAMP
);

-- ══════════════════════════════════════════
-- 5. customers — Customer master
-- ══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS `{PROJECT}.{DATASET}.customers` (
  id STRING,
  customer_id STRING,
  shop_id STRING,
  shop_name STRING,
  project_id STRING,
  name STRING,
  phone_numbers STRING,
  emails STRING,
  gender STRING,
  date_of_birth STRING,
  order_count INT64,
  succeed_order_count INT64,
  returned_order_count INT64,
  purchased_amount FLOAT64,
  current_debts FLOAT64,
  reward_point INT64,
  used_reward_point INT64,
  referral_code STRING,
  level STRING,
  tags STRING,
  is_block BOOL,
  inserted_at STRING,
  updated_at STRING,
  sync_time TIMESTAMP
);
