-- ============================================================
-- vw_fact_orders — Master Order View (THE FOUNDATION)
-- Rewritten for actual BQ schema (pre-flattened Pancake data)
-- ============================================================
-- Source: sale_order (25,539 rows, 46 columns)
-- Status is already a string (e.g., 'canceled', 'delivered')
-- Money values are already in standard units (no ÷100)
-- No JSON parsing needed — all fields are flat
-- ============================================================

CREATE OR REPLACE VIEW `{PROJECT}.{DATASET}.vw_fact_orders` AS

SELECT
  -- ==================== IDs ====================
  order_id,
  shop_id,
  customer_id,
  COALESCE(SO_id, '') AS so_display_id,
  
  -- ==================== Dates ====================
  DATE(created_at) AS order_date,
  CAST(created_at AS TIMESTAMP) AS created_at,
  CAST(updated_at AS TIMESTAMP) AS updated_at,
  
  -- ==================== Status ====================
  status AS status_label,
  
  -- Status grouping for funnel analysis
  CASE
    WHEN status IN ('new', 'ordered', 'submitted', 'wait_submit', 
                    'pending', 'packing', 'printed', 'waitting')
      THEN 'processing'
    WHEN status = 'shipped' THEN 'in_transit'
    WHEN status IN ('delivered', 'received_money') THEN 'success'
    WHEN status = 'returning' THEN 'returning'
    WHEN status = 'returned' THEN 'returned'
    WHEN status IN ('canceled', 'removed') THEN 'canceled'
    ELSE 'other'
  END AS status_group,
  
  -- Boolean flags
  status IN ('delivered', 'received_money') AS is_success,
  status IN ('returning', 'returned') AS is_returned,
  FALSE AS is_partial_return,
  status IN ('canceled', 'removed') AS is_canceled,
  
  -- ==================== Monetary (already in standard units) ====================
  COALESCE(cod, 0) AS cod_amount,
  COALESCE(prepaid_amount, 0) AS total_prepaid,
  COALESCE(cod, 0) + COALESCE(prepaid_amount, 0) AS gross_revenue,
  COALESCE(money_to_collect, 0) AS money_to_collect,
  COALESCE(carrier_fee_paid, 0) AS carrier_fee,
  COALESCE(exchange_amount, 0) AS exchange_amount,
  COALESCE(shipping_fee_from_customer, 0) AS shipping_fee_from_customer,
  COALESCE(total_product_quantity, 0) AS total_quantity,
  
  -- ==================== Reconciliation ====================
  COALESCE(cod_reconciled, 0) AS cod_reconciled,
  reconciliation_date,
  -- Gap = expected COD - reconciled COD
  COALESCE(cod, 0) - COALESCE(cod_reconciled, 0) AS reconciliation_gap,
  
  -- ==================== Attribution ====================
  COALESCE(marketer, '') AS marketer_name,
  COALESCE(marketer_id, '') AS marketer_id,
  COALESCE(cs_staff, '') AS cs_staff_name,
  COALESCE(cs_staff_id, '') AS cs_staff_id,
  COALESCE(confirming_staff, '') AS confirming_staff_id,
  COALESCE(created_by_id, '') AS creator_id,
  
  -- Traffic source
  COALESCE(ads_source, '') AS ads_source,
  COALESCE(ads_id, '') AS ads_id,
  COALESCE(post_id, '') AS post_id,
  
  -- Order source
  COALESCE(order_source_name, '') AS order_source_name,
  
  -- ==================== Channel ====================
  COALESCE(page_name, '') AS page_name,
  COALESCE(page_id, '') AS page_id,
  
  -- ==================== Customer Info ====================
  COALESCE(recipient_name, '') AS recipient_name,
  COALESCE(shipping_address, '') AS shipping_address,
  COALESCE(district, '') AS district,
  COALESCE(province_city, '') AS province_city,
  COALESCE(region_code, '') AS region_code,
  COALESCE(customer_type_new_returning, '') AS customer_type,
  
  -- ==================== Carrier ====================
  COALESCE(tracking_number, '') AS tracking_number,
  COALESCE(shipping_carrier_name, '') AS carrier_name,
  COALESCE(shipping_carrier_id, '') AS carrier_id,
  expected_delivery_date,
  
  -- ==================== Returns ====================
  COALESCE(return_reason, '') AS return_reason_code,
  COALESCE(return_reason_name, '') AS return_reason_name,
  COALESCE(customer_refund, 'false') AS customer_refund,
  
  -- ==================== Warehouse ====================
  COALESCE(warehouse_id, '') AS warehouse_id,
  COALESCE(warehouse_name, '') AS warehouse_name,
  
  -- ==================== Currency ====================
  COALESCE(currency, 'VND') AS currency_code,
  
  -- ==================== SLA ====================
  DATE_DIFF(CURRENT_DATE(), DATE(updated_at), DAY) AS days_since_last_update,
  CASE
    WHEN status IN ('new', 'ordered', 'submitted', 'wait_submit', 
                    'pending', 'packing', 'shipped') 
      AND DATE_DIFF(CURRENT_DATE(), DATE(created_at), DAY) > 2
    THEN TRUE
    WHEN status = 'waitting'
      AND DATE_DIFF(CURRENT_DATE(), DATE(created_at), DAY) > 7
    THEN TRUE
    ELSE FALSE
  END AS is_sla_breach,

FROM `{PROJECT}.{DATASET}.sale_order`;
