-- ============================================================
-- vw_dim_customers — Customer Dimension View
-- Rewritten for actual BQ schema (customer table)
-- ============================================================
-- Source: customer (5,881 rows, 16 columns)
-- Pre-computed RFM segment, fraud risk, lifecycle stage
-- ============================================================

CREATE OR REPLACE VIEW `{PROJECT}.{DATASET}.vw_dim_customers` AS

WITH order_stats AS (
  -- Aggregate order stats per customer from orders view
  SELECT
    customer_id,
    COUNT(*) AS total_orders_calc,
    COUNTIF(is_success) AS success_orders_calc,
    COUNTIF(is_returned) AS returned_orders_calc,
    SUM(CASE WHEN is_success THEN gross_revenue ELSE 0 END) AS total_revenue,
    MAX(order_date) AS last_order_date_calc,
    MIN(order_date) AS first_order_date_calc,
    -- Most frequent shop_id for this customer (for multi-project separation)
    ARRAY_AGG(shop_id ORDER BY order_date DESC LIMIT 1)[SAFE_OFFSET(0)] AS primary_shop_id,
  FROM `{PROJECT}.{DATASET}.vw_fact_orders`
  GROUP BY customer_id
)

SELECT
  -- ==================== IDs ====================
  c.customer_id,
  
  -- ==================== Profile ====================
  COALESCE(c.customer_name, 'Unknown') AS customer_name,
  COALESCE(c.customer_phone, '') AS phone,
  COALESCE(c.customer_email, '') AS email,
  COALESCE(c.customer_gender, '') AS gender,
  SAFE.PARSE_DATE('%Y-%m-%d', c.customer_birthday) AS date_of_birth,
  COALESCE(c.customer_level, '') AS customer_level,
  COALESCE(c.from_page_id, '') AS from_page_id,
  COALESCE(c.from_shop_id, '') AS from_shop_id,
  -- Primary shop_id for multi-project filtering (from most recent order)
  COALESCE(os.primary_shop_id, c.from_shop_id, '') AS shop_id,
  
  -- ==================== Order Stats ====================
  -- Use the larger of pre-computed vs calculated values
  GREATEST(COALESCE(c.order_count, 0), COALESCE(os.total_orders_calc, 0)) AS total_orders,
  GREATEST(COALESCE(c.succeed_order_count, 0), COALESCE(os.success_orders_calc, 0)) AS success_orders,
  COALESCE(os.returned_orders_calc, 0) AS returned_orders,
  
  -- ==================== Monetary ====================
  GREATEST(
    COALESCE(c.purchased_amount, 0),
    COALESCE(os.total_revenue, 0)
  ) AS lifetime_value,
  
  -- Average Order Value
  SAFE_DIVIDE(
    GREATEST(COALESCE(c.purchased_amount, 0), COALESCE(os.total_revenue, 0)),
    NULLIF(GREATEST(COALESCE(c.succeed_order_count, 0), COALESCE(os.success_orders_calc, 0)), 0)
  ) AS avg_order_value,
  
  -- ==================== Recency ====================
  COALESCE(os.last_order_date_calc, DATE(c.created_at)) AS last_order_date,
  DATE(c.created_at) AS first_seen_date,
  DATE_DIFF(
    CURRENT_DATE(), 
    COALESCE(os.last_order_date_calc, DATE(c.created_at)), 
    DAY
  ) AS days_since_last_order,
  DATE_DIFF(CURRENT_DATE(), DATE(c.created_at), DAY) AS customer_age_days,
  
  -- ==================== Quality Metrics ====================
  SAFE_DIVIDE(
    COALESCE(os.returned_orders_calc, 0),
    NULLIF(GREATEST(COALESCE(c.order_count, 0), COALESCE(os.total_orders_calc, 0)), 0)
  ) AS return_rate,
  
  SAFE_DIVIDE(
    GREATEST(COALESCE(c.succeed_order_count, 0), COALESCE(os.success_orders_calc, 0)),
    NULLIF(GREATEST(COALESCE(c.order_count, 0), COALESCE(os.total_orders_calc, 0)), 0)
  ) AS success_rate,
  
  -- ==================== RFM Segment ====================
  CASE
    WHEN COALESCE(c.succeed_order_count, 0) >= 5 
      AND DATE_DIFF(CURRENT_DATE(), COALESCE(os.last_order_date_calc, DATE(c.created_at)), DAY) < 30 
      THEN 'Champions'
    WHEN COALESCE(c.succeed_order_count, 0) >= 3 
      AND DATE_DIFF(CURRENT_DATE(), COALESCE(os.last_order_date_calc, DATE(c.created_at)), DAY) < 45 
      THEN 'Loyal'
    WHEN COALESCE(c.succeed_order_count, 0) >= 2 
      AND DATE_DIFF(CURRENT_DATE(), COALESCE(os.last_order_date_calc, DATE(c.created_at)), DAY) < 60 
      THEN 'Potential_Loyal'
    WHEN COALESCE(c.succeed_order_count, 0) = 1 
      AND DATE_DIFF(CURRENT_DATE(), COALESCE(os.last_order_date_calc, DATE(c.created_at)), DAY) < 30 
      THEN 'New'
    WHEN COALESCE(c.succeed_order_count, 0) >= 3 
      AND DATE_DIFF(CURRENT_DATE(), COALESCE(os.last_order_date_calc, DATE(c.created_at)), DAY) BETWEEN 60 AND 120 
      THEN 'At_Risk'
    WHEN COALESCE(c.succeed_order_count, 0) >= 3 
      AND DATE_DIFF(CURRENT_DATE(), COALESCE(os.last_order_date_calc, DATE(c.created_at)), DAY) > 120 
      THEN 'Cant_Lose'
    WHEN DATE_DIFF(CURRENT_DATE(), COALESCE(os.last_order_date_calc, DATE(c.created_at)), DAY) > 90 
      THEN 'Lost'
    ELSE 'Other'
  END AS rfm_segment,
  
  -- ==================== Fraud Risk ====================
  CASE
    WHEN SAFE_DIVIDE(
        COALESCE(os.returned_orders_calc, 0),
        NULLIF(COALESCE(c.order_count, 0), 0)
      ) > 0.5 AND COALESCE(c.order_count, 0) >= 5 
      THEN 'HIGH'
    WHEN COALESCE(os.returned_orders_calc, 0) >= 3 THEN 'MEDIUM'
    ELSE 'LOW'
  END AS fraud_risk,
  
  -- ==================== Lifecycle ====================
  CASE
    WHEN COALESCE(c.succeed_order_count, 0) >= 5 
      AND DATE_DIFF(CURRENT_DATE(), COALESCE(os.last_order_date_calc, DATE(c.created_at)), DAY) < 30 
      THEN 'active_vip'
    WHEN COALESCE(c.succeed_order_count, 0) >= 2 
      AND DATE_DIFF(CURRENT_DATE(), COALESCE(os.last_order_date_calc, DATE(c.created_at)), DAY) < 60 
      THEN 'active_repeat'
    WHEN COALESCE(c.succeed_order_count, 0) = 1 
      AND DATE_DIFF(CURRENT_DATE(), COALESCE(os.last_order_date_calc, DATE(c.created_at)), DAY) < 30 
      THEN 'new_customer'
    WHEN DATE_DIFF(CURRENT_DATE(), COALESCE(os.last_order_date_calc, DATE(c.created_at)), DAY) > 90 
      THEN 'churned'
    WHEN DATE_DIFF(CURRENT_DATE(), COALESCE(os.last_order_date_calc, DATE(c.created_at)), DAY) BETWEEN 60 AND 90 
      THEN 'at_risk'
    ELSE 'dormant'
  END AS lifecycle_stage,
  
  -- ==================== Audience Export Flags ====================
  CASE 
    WHEN COALESCE(c.succeed_order_count, 0) >= 3 
      AND DATE_DIFF(CURRENT_DATE(), COALESCE(os.last_order_date_calc, DATE(c.created_at)), DAY) < 45 
    THEN TRUE ELSE FALSE 
  END AS is_vip_seed,
  
  CASE
    WHEN SAFE_DIVIDE(
        COALESCE(os.returned_orders_calc, 0),
        NULLIF(COALESCE(c.order_count, 0), 0)
      ) > 0.5 AND COALESCE(c.order_count, 0) >= 5
    THEN TRUE ELSE FALSE 
  END AS is_exclusion_list,
  
  -- Currency
  COALESCE(c.currency, 'VND') AS currency,

FROM `{PROJECT}.{DATASET}.customer` c
LEFT JOIN order_stats os ON c.customer_id = os.customer_id;
