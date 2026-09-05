-- ╔══════════════════════════════════════════════════════════╗
-- ║  vw_fact_daily_pnl: 7-layer P&L waterfall per day       ║
-- ║  with marketer/country/product dimensions                ║
-- ╚══════════════════════════════════════════════════════════╝
-- Filters: marketer, country, date, status_group

CREATE OR REPLACE VIEW `{PROJECT}.{DATASET}.vw_fact_daily_pnl` AS

WITH daily_orders AS (
  SELECT
    o.order_date AS date,
    o.project_id,
    o.shop_name,
    o.market_code,
    o.currency,
    o.marketer_name,
    -- Layer 1: Gross Revenue
    SUM(o.revenue) AS gross_revenue,
    -- Layer 2: Returns
    SUM(CASE WHEN o.status_group IN ('returned','returning') THEN o.revenue ELSE 0 END) AS returned_revenue,
    -- Layer 3: Net Revenue = Gross - Returns
    SUM(CASE WHEN o.status_group NOT IN ('returned','returning','cancelled','excluded') THEN o.revenue ELSE 0 END) AS net_revenue,
    -- Collected (success only)
    SUM(CASE WHEN o.status_group = 'success' THEN o.revenue ELSE 0 END) AS collected_revenue,
    -- Shipping + fees
    SUM(o.shipping_fee) AS total_shipping,
    SUM(o.partner_fee) AS total_partner_fee,
    SUM(o.return_fee) AS total_return_fee,
    SUM(o.marketplace_fee) AS total_marketplace_fee,
    SUM(o.surcharge + o.tax) AS total_other_costs,
    SUM(o.total_discount) AS total_discount,
    -- Payment breakdown
    SUM(o.cash) AS total_cash,
    SUM(o.transfer_money) AS total_transfer,
    SUM(o.card_payment) AS total_card,
    -- Counts
    COUNT(*) AS total_orders,
    COUNTIF(o.status_group = 'success') AS success_orders,
    COUNTIF(o.status_group IN ('returned','returning')) AS returned_orders,
    COUNTIF(o.status_group = 'processing') AS processing_orders,
    COUNTIF(o.status_group = 'shipping') AS shipping_orders,
    COUNTIF(o.status_group = 'cancelled') AS cancelled_orders,
    SUM(o.total_quantity) AS total_items
  FROM `{PROJECT}.{DATASET}.vw_fact_orders` o
  GROUP BY 1,2,3,4,5,6
),

daily_cogs AS (
  SELECT
    DATE(PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%E*S', oi.order_inserted_at)) AS date,
    COALESCE(sp.project_id, oi.project_id) AS project_id,
    oi.shop_name,
    COALESCE(NULLIF(o.marketer, ''), NULLIF(o.pke_mkter, ''), 'Unknown') AS marketer_name,
    -- Layer 4: COGS
    SUM(oi.quantity * oi.avg_imported_price) / COALESCE(sp.currency_divisor, 1) AS total_cogs,
    SUM(oi.return_quantity * oi.avg_imported_price) / COALESCE(sp.currency_divisor, 1) AS returned_cogs
  FROM `{PROJECT}.{DATASET}.order_items` oi
  JOIN `{PROJECT}.{DATASET}.sale_order` o ON oi.order_id = o.id AND oi.shop_id = o.shop_id
  LEFT JOIN `{PROJECT}.Zen8_Dataset.dim_shop_project` sp ON oi.shop_id = sp.shop_id
  GROUP BY 1,2,3,4, sp.currency_divisor
),

daily_ads AS (
  SELECT
    a.date AS date,
    '' AS marketer_name,
    -- Layer 6: Ad Spend
    SUM(a.spend) AS total_ad_spend,
    SUM(a.impressions) AS total_impressions,
    SUM(a.clicks) AS total_clicks,
    SUM(a.reach) AS total_reach
  FROM `{PROJECT}.{DATASET}.fb_ads_data` a
  WHERE a.spend > 0
  GROUP BY 1,2
)

SELECT
  o.date,
  o.project_id,
  o.shop_name,
  o.market_code,
  o.currency,
  o.marketer_name,
  -- ═══ 7-LAYER P&L WATERFALL ═══
  -- 1. Gross Revenue
  o.gross_revenue,
  -- 2. (-) Returns
  o.returned_revenue,
  -- 3. (=) Net Revenue
  o.net_revenue,
  -- 4. (-) COGS
  COALESCE(c.total_cogs, 0) AS cogs,
  -- 5. (=) Gross Profit
  o.net_revenue - COALESCE(c.total_cogs, 0) AS gross_profit,
  -- 6. (-) Shipping + Fulfillment
  o.total_shipping + o.total_partner_fee + o.total_return_fee AS fulfillment_costs,
  o.total_marketplace_fee AS marketplace_costs,
  -- 7. (-) Ad Spend (joined loosely by date)
  COALESCE(ad.total_ad_spend, 0) AS ad_spend,
  -- (=) Operating Profit
  o.net_revenue - COALESCE(c.total_cogs, 0) 
    - o.total_shipping - o.total_partner_fee - o.total_return_fee 
    - o.total_marketplace_fee - COALESCE(ad.total_ad_spend, 0) AS operating_profit,
  -- Margins
  SAFE_DIVIDE(o.net_revenue - COALESCE(c.total_cogs, 0), NULLIF(o.net_revenue, 0)) AS gross_margin,
  SAFE_DIVIDE(
    o.net_revenue - COALESCE(c.total_cogs, 0) - o.total_shipping - o.total_partner_fee 
    - o.total_return_fee - o.total_marketplace_fee - COALESCE(ad.total_ad_spend, 0),
    NULLIF(o.net_revenue, 0)
  ) AS operating_margin,
  -- Discount
  o.total_discount,
  o.total_other_costs,
  -- Payment
  o.total_cash,
  o.total_transfer,
  o.total_card,
  -- Counts
  o.total_orders,
  o.success_orders,
  o.returned_orders,
  o.processing_orders,
  o.shipping_orders,
  o.cancelled_orders,
  o.total_items,
  -- Rates
  SAFE_DIVIDE(o.returned_orders, NULLIF(o.total_orders, 0)) AS return_rate,
  SAFE_DIVIDE(o.gross_revenue, NULLIF(o.total_orders, 0)) AS avg_order_value,
  SAFE_DIVIDE(o.success_orders, NULLIF(o.total_orders, 0)) AS success_rate,
  -- Ads metrics
  COALESCE(ad.total_impressions, 0) AS impressions,
  COALESCE(ad.total_clicks, 0) AS clicks,
  -- ROAS
  SAFE_DIVIDE(o.gross_revenue, NULLIF(COALESCE(ad.total_ad_spend, 0), 0)) AS roas_gross,
  SAFE_DIVIDE(o.net_revenue - COALESCE(c.total_cogs, 0), NULLIF(COALESCE(ad.total_ad_spend, 0), 0)) AS roas_real
FROM daily_orders o
LEFT JOIN daily_cogs c ON o.date = c.date AND o.project_id = c.project_id 
  AND o.shop_name = c.shop_name AND o.marketer_name = c.marketer_name
LEFT JOIN daily_ads ad ON o.date = ad.date
;
