-- ╔══════════════════════════════════════════════════════════════════╗
-- ║  TALPHA — BigQuery Schema (13 tables)                          ║
-- ║  Dataset: TALPHA_Dataset                                       ║
-- ║  Project: levelup-465304                                       ║
-- ║  Independent from STRAMARK / AUUS1                             ║
-- ╚══════════════════════════════════════════════════════════════════╝

-- ══════════════════════════════════════════
-- 1. staging_sale_order
-- ══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS `levelup-465304.TALPHA_Dataset.staging_sale_order` (
  id STRING,
  system_id INT64,
  shop_id STRING,
  shop_name STRING,
  project_id STRING DEFAULT 'TALPHA',

  status INT64,
  status_name STRING,
  sub_status STRING,

  cod FLOAT64,
  prepaid FLOAT64,
  total_price FLOAT64,
  total_price_after_sub_discount FLOAT64,
  total_discount FLOAT64,

  shipping_fee FLOAT64,
  partner_fee FLOAT64,
  return_fee FLOAT64,
  fee_marketplace FLOAT64,
  surcharge FLOAT64,
  tax FLOAT64,
  customer_pay_fee FLOAT64,

  cash FLOAT64,
  transfer_money FLOAT64,
  charged_by_card FLOAT64,
  charged_by_momo FLOAT64,
  charged_by_qrpay FLOAT64,
  money_to_collect FLOAT64,
  prepaid_by_point FLOAT64,
  buyer_total_amount FLOAT64,

  total_quantity INT64,
  items_length INT64,

  bill_full_name STRING,
  bill_phone_number STRING,
  bill_email STRING,
  customer_id STRING,
  customer_name STRING,

  shipping_address STRING,
  shipping_province STRING,
  shipping_district STRING,

  marketer STRING,
  pke_mkter STRING,
  assigning_seller_id STRING,
  assigning_care_id STRING,
  creator STRING,
  account_name STRING,

  ad_id STRING,
  adset_id STRING,
  ads_source STRING,
  p_utm_source STRING,
  p_utm_campaign STRING,
  p_utm_medium STRING,
  p_utm_content STRING,
  p_utm_term STRING,
  p_utm_id STRING,

  order_sources_name STRING,
  page_id STRING,
  conversation_id STRING,
  post_id STRING,
  is_livestream BOOL,
  is_live_shopping BOOL,

  partner STRING,
  tracking_link STRING,
  warehouse_id STRING,
  order_currency STRING,
  is_exchange_order BOOL,
  is_free_shipping BOOL,

  inserted_at STRING,
  updated_at STRING,
  time_send_partner STRING,
  estimate_delivery_date STRING,

  note STRING,
  tags STRING,
  order_link STRING,
  sync_time TIMESTAMP
);

-- ══════════════════════════════════════════
-- 2. staging_order_items
-- ══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS `levelup-465304.TALPHA_Dataset.staging_order_items` (
  item_id STRING,
  order_id STRING,
  order_system_id INT64,
  shop_id STRING,
  shop_name STRING,
  project_id STRING DEFAULT 'TALPHA',

  product_id STRING,
  variation_id STRING,
  product_name STRING,
  variation_name STRING,
  barcode STRING,

  quantity INT64,
  return_quantity INT64,
  returned_count INT64,
  returning_quantity INT64,

  retail_price FLOAT64,
  discount_each_product FLOAT64,
  total_discount FLOAT64,
  same_price_discount FLOAT64,
  avg_imported_price FLOAT64,

  is_bonus_product BOOL,
  is_composite BOOL,
  is_wholesale BOOL,

  order_inserted_at STRING,
  sync_time TIMESTAMP
);

-- ══════════════════════════════════════════
-- 3. staging_fb_ads_data
-- ══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS `levelup-465304.TALPHA_Dataset.staging_fb_ads_data` (
  ad_id STRING,
  ad_name STRING,
  adset_id STRING,
  adset_name STRING,
  campaign_id STRING,
  campaign_name STRING,
  account_id STRING,
  account_name STRING,
  date_start STRING,
  date_stop STRING,
  spend FLOAT64,
  impressions INT64,
  reach INT64,
  clicks INT64,
  cpm FLOAT64,
  cpc FLOAT64,
  ctr FLOAT64,
  actions_message STRING,
  actions_purchase STRING,
  actions_lead STRING,
  action_values_purchase FLOAT64,
  project_id STRING DEFAULT 'TALPHA',
  sync_time TIMESTAMP
);

-- ══════════════════════════════════════════
-- 4. sale_order (main — dedup by id+shop_id)
-- ══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS `levelup-465304.TALPHA_Dataset.sale_order` (
  id STRING,
  system_id INT64,
  shop_id STRING,
  shop_name STRING,
  project_id STRING DEFAULT 'TALPHA',
  status INT64,
  status_name STRING,
  sub_status STRING,
  cod FLOAT64,
  prepaid FLOAT64,
  total_price FLOAT64,
  total_price_after_sub_discount FLOAT64,
  total_discount FLOAT64,
  shipping_fee FLOAT64,
  partner_fee FLOAT64,
  return_fee FLOAT64,
  fee_marketplace FLOAT64,
  surcharge FLOAT64,
  tax FLOAT64,
  customer_pay_fee FLOAT64,
  cash FLOAT64,
  transfer_money FLOAT64,
  charged_by_card FLOAT64,
  charged_by_momo FLOAT64,
  charged_by_qrpay FLOAT64,
  money_to_collect FLOAT64,
  prepaid_by_point FLOAT64,
  buyer_total_amount FLOAT64,
  total_quantity INT64,
  items_length INT64,
  bill_full_name STRING,
  bill_phone_number STRING,
  bill_email STRING,
  customer_id STRING,
  customer_name STRING,
  shipping_address STRING,
  shipping_province STRING,
  shipping_district STRING,
  marketer STRING,
  pke_mkter STRING,
  assigning_seller_id STRING,
  assigning_care_id STRING,
  creator STRING,
  account_name STRING,
  ad_id STRING,
  adset_id STRING,
  ads_source STRING,
  p_utm_source STRING,
  p_utm_campaign STRING,
  p_utm_medium STRING,
  p_utm_content STRING,
  p_utm_term STRING,
  p_utm_id STRING,
  order_sources_name STRING,
  page_id STRING,
  conversation_id STRING,
  post_id STRING,
  is_livestream BOOL,
  is_live_shopping BOOL,
  partner STRING,
  tracking_link STRING,
  warehouse_id STRING,
  order_currency STRING,
  is_exchange_order BOOL,
  is_free_shipping BOOL,
  inserted_at STRING,
  updated_at STRING,
  time_send_partner STRING,
  estimate_delivery_date STRING,
  note STRING,
  tags STRING,
  order_link STRING,
  sync_time TIMESTAMP
);

-- ══════════════════════════════════════════
-- 5. order_items (main — dedup by item_id+order_id)
-- ══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS `levelup-465304.TALPHA_Dataset.order_items` (
  item_id STRING,
  order_id STRING,
  order_system_id INT64,
  shop_id STRING,
  shop_name STRING,
  project_id STRING DEFAULT 'TALPHA',
  product_id STRING,
  variation_id STRING,
  product_name STRING,
  variation_name STRING,
  barcode STRING,
  quantity INT64,
  return_quantity INT64,
  returned_count INT64,
  returning_quantity INT64,
  retail_price FLOAT64,
  discount_each_product FLOAT64,
  total_discount FLOAT64,
  same_price_discount FLOAT64,
  avg_imported_price FLOAT64,
  is_bonus_product BOOL,
  is_composite BOOL,
  is_wholesale BOOL,
  order_inserted_at STRING,
  sync_time TIMESTAMP
);

-- ══════════════════════════════════════════
-- 6. fb_ads_data (main — dedup by ad_id+date_start)
-- ══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS `levelup-465304.TALPHA_Dataset.fb_ads_data` (
  ad_id STRING,
  ad_name STRING,
  adset_id STRING,
  adset_name STRING,
  campaign_id STRING,
  campaign_name STRING,
  account_id STRING,
  account_name STRING,
  date_start STRING,
  date_stop STRING,
  spend FLOAT64,
  impressions INT64,
  reach INT64,
  clicks INT64,
  cpm FLOAT64,
  cpc FLOAT64,
  ctr FLOAT64,
  actions_message STRING,
  actions_purchase STRING,
  actions_lead STRING,
  action_values_purchase FLOAT64,
  project_id STRING DEFAULT 'TALPHA',
  sync_time TIMESTAMP
);

-- ══════════════════════════════════════════
-- 7. fb_adset_data
-- ══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS `levelup-465304.TALPHA_Dataset.fb_adset_data` (
  adset_id STRING,
  adset_name STRING,
  campaign_id STRING,
  campaign_name STRING,
  account_id STRING,
  date_start STRING,
  date_stop STRING,
  spend FLOAT64,
  impressions INT64,
  reach INT64,
  clicks INT64,
  actions_message STRING,
  actions_purchase STRING,
  action_values_purchase FLOAT64,
  project_id STRING DEFAULT 'TALPHA',
  sync_time TIMESTAMP
);

-- ══════════════════════════════════════════
-- 8. product_template
-- ══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS `levelup-465304.TALPHA_Dataset.product_template` (
  id STRING,
  shop_id STRING,
  shop_name STRING,
  project_id STRING DEFAULT 'TALPHA',
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
-- 9. product_variations
-- ══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS `levelup-465304.TALPHA_Dataset.product_variations` (
  id STRING,
  product_id STRING,
  shop_id STRING,
  shop_name STRING,
  project_id STRING DEFAULT 'TALPHA',
  display_id STRING,
  barcode STRING,
  retail_price FLOAT64,
  retail_price_after_discount FLOAT64,
  average_imported_price FLOAT64,
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
-- 10. ads_product_mapping (DYNAMIC — ad_id primary + campaign name fallback)
-- ══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS `levelup-465304.TALPHA_Dataset.ads_product_mapping` (
  campaign_product_code STRING,
  primary_sku STRING,
  primary_product_name STRING,
  secondary_skus STRING,
  mapping_source STRING,          -- ad_id_crossref | campaign_name | manual
  confidence STRING,              -- HIGH | MEDIUM | LOW | PENDING
  sample_count INT64,
  is_test_product BOOL,
  first_seen_at TIMESTAMP,
  last_updated_at TIMESTAMP,
  effective_from TIMESTAMP,       -- Mapping CHỈ áp dụng cho data TỪ thời điểm này
  updated_by STRING               -- auto_sync | manual_review
);

-- ══════════════════════════════════════════
-- 11. product_mapping_log (audit trail)
-- ══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS `levelup-465304.TALPHA_Dataset.product_mapping_log` (
  ad_id STRING,
  campaign_name STRING,
  campaign_product_code STRING,
  order_id STRING,
  order_items_json STRING,
  shop_id STRING,
  shop_name STRING,
  mapping_source STRING,
  mapped_at TIMESTAMP
);

-- ══════════════════════════════════════════
-- 12. test_product_analysis
-- ══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS `levelup-465304.TALPHA_Dataset.test_product_analysis` (
  campaign_product_code STRING,
  -- Ads metrics
  ads_spend FLOAT64,
  impressions INT64,
  reach INT64,
  messages INT64,
  purchases INT64,
  cpm FLOAT64,
  cpo FLOAT64,
  cost_per_msg FLOAT64,
  -- POS metrics
  pos_orders INT64,
  pos_revenue FLOAT64,
  roas FLOAT64,
  pos_product_exists BOOL,
  -- Classification
  -- WIN: ROAS > 6 | POTENTIAL: > 5 | AVERAGE: > 4
  -- MICRO_TEST: spend < 800K VND + no POS + no orders
  -- SELLING: has orders + revenue > 0
  evaluation STRING,
  is_test BOOL,
  -- Detail
  campaigns INT64,
  by_marketer_json STRING,
  analysis_period STRING,
  updated_at TIMESTAMP
);

-- ══════════════════════════════════════════
-- 13. customers
-- ══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS `levelup-465304.TALPHA_Dataset.customers` (
  id STRING,
  customer_id STRING,
  shop_id STRING,
  shop_name STRING,
  project_id STRING DEFAULT 'TALPHA',
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
