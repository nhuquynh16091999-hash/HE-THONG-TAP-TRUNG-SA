-- ╔══════════════════════════════════════════════════════════╗
-- ║  vw_fact_orders: Order detail with unified status,      ║
-- ║  currency normalization, and filter dimensions           ║
-- ╚══════════════════════════════════════════════════════════╝
-- Usage: SELECT * FROM `{PROJECT}.{DATASET}.vw_fact_orders` 
--        WHERE marketer_name != 'Unknown' AND market_code = 'RO'
-- Filters: project, marketer, country, product, status_group, date

CREATE OR REPLACE VIEW `{PROJECT}.{DATASET}.vw_fact_orders` AS

WITH orders_base AS (
  SELECT
    o.*,
    DATE(PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%E*S', o.inserted_at)) AS order_date,
    -- Currency normalization
    COALESCE(sp.currency_divisor, 1) AS currency_divisor,
    COALESCE(sp.currency, 'USD') AS currency,
    COALESCE(sp.market_code, '') AS market_code,
    COALESCE(sp.market_name, '') AS market_name,
    COALESCE(sp.project_id, o.project_id) AS resolved_project_id,
    COALESCE(sp.ads_match_type, 'ad_id') AS ads_match_type,
    -- Status grouping
    COALESCE(sm.status_group, 'unknown') AS status_group,
    COALESCE(sm.display_name, o.status_name) AS status_display,
    COALESCE(sm.revenue_impact, 'unknown') AS revenue_impact,
    -- Marketer cleanup
    COALESCE(NULLIF(o.marketer, ''), NULLIF(o.pke_mkter, ''), 'Unknown') AS marketer_name
  FROM `{PROJECT}.{DATASET}.sale_order` o
  LEFT JOIN `{PROJECT}.Zen8_Dataset.dim_shop_project` sp ON o.shop_id = sp.shop_id
  LEFT JOIN `{PROJECT}.Zen8_Dataset.dim_status_mapping` sm ON o.status = sm.status_code
)

SELECT
  ob.order_date,
  ob.resolved_project_id AS project_id,
  ob.shop_id,
  ob.shop_name,
  ob.market_code,
  ob.market_name,
  ob.currency,
  ob.id AS order_id,
  ob.system_id,
  ob.status,
  ob.status_name,
  ob.status_group,
  ob.status_display,
  ob.revenue_impact,
  -- Revenue (currency normalized)
  (ob.cod + ob.prepaid) / ob.currency_divisor AS revenue,
  ob.cod / ob.currency_divisor AS cod_amount,
  ob.prepaid / ob.currency_divisor AS prepaid_amount,
  ob.total_price / ob.currency_divisor AS total_price,
  ob.total_discount / ob.currency_divisor AS total_discount,
  ob.money_to_collect / ob.currency_divisor AS money_to_collect,
  -- Costs (currency normalized)
  ob.shipping_fee / ob.currency_divisor AS shipping_fee,
  ob.partner_fee / ob.currency_divisor AS partner_fee,
  ob.return_fee / ob.currency_divisor AS return_fee,
  ob.fee_marketplace / ob.currency_divisor AS marketplace_fee,
  ob.surcharge / ob.currency_divisor AS surcharge,
  ob.tax / ob.currency_divisor AS tax,
  (ob.shipping_fee + ob.partner_fee + ob.return_fee + ob.fee_marketplace) / ob.currency_divisor AS total_order_costs,
  -- Payment (normalized)
  ob.cash / ob.currency_divisor AS cash,
  ob.transfer_money / ob.currency_divisor AS transfer_money,
  ob.charged_by_card / ob.currency_divisor AS card_payment,
  ob.charged_by_momo / ob.currency_divisor AS momo_payment,
  ob.charged_by_qrpay / ob.currency_divisor AS qrpay_payment,
  -- Quantities
  ob.total_quantity,
  ob.items_length,
  -- Customer
  ob.customer_id,
  ob.customer_name,
  ob.bill_full_name,
  ob.bill_phone_number,
  ob.shipping_address,
  ob.shipping_province,
  ob.shipping_district,
  -- Attribution
  ob.marketer_name,
  ob.ad_id,
  ob.ads_source,
  ob.p_utm_source,
  ob.p_utm_campaign,
  ob.p_utm_medium,
  ob.p_utm_content,
  ob.p_utm_term,
  ob.page_id,
  ob.order_sources_name,
  ob.account_name,
  ob.ads_match_type,
  -- Fulfillment
  ob.partner AS shipping_partner,
  ob.tracking_link,
  ob.order_currency,
  -- Timestamps
  ob.inserted_at,
  ob.updated_at,
  ob.note
FROM orders_base ob
WHERE ob.status != 7  -- Exclude deleted
;
