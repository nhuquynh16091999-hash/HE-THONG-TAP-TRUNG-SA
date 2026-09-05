-- ============================================================
-- vw_dim_customer_segments — Customer Segments (GOLD VIEW)
-- Owner: A8 (CRM Analyst)
-- Depends on: vw_dim_customers (Base View)
-- ============================================================
-- Thin wrapper over vw_dim_customers for backward compatibility.
-- All logic (RFM, fraud, lifecycle) already computed in base view.
-- This view just selects the columns A8 needs.
-- ============================================================

CREATE OR REPLACE VIEW `{PROJECT}.{DATASET}.vw_dim_customer_segments` AS

SELECT
  customer_id,
  customer_name,
  phone,
  email,
  gender,
  customer_level,
  
  -- Multi-project filtering
  shop_id,
  
  -- Core metrics
  success_orders,
  total_orders,
  returned_orders,
  lifetime_value,
  avg_order_value,
  days_since_last_order,
  return_rate,
  success_rate,
  
  -- Segments (pre-computed in base view)
  rfm_segment,
  fraud_risk,
  lifecycle_stage,
  
  -- Audience flags
  is_vip_seed,
  is_exclusion_list,

FROM `{PROJECT}.{DATASET}.vw_dim_customers`;
