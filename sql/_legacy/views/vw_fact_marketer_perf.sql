-- ╔══════════════════════════════════════════════════════════╗
-- ║  vw_fact_marketer_perf: Marketer scoreboard              ║
-- ║  Revenue, COGS, Profit, Ads, ROAS per marketer           ║
-- ╚══════════════════════════════════════════════════════════╝

CREATE OR REPLACE VIEW `{PROJECT}.{DATASET}.vw_fact_marketer_perf` AS

SELECT
  o.order_date AS date,
  o.project_id,
  o.market_code,
  o.currency,
  o.marketer_name,
  -- Revenue
  SUM(o.revenue) AS gross_revenue,
  SUM(CASE WHEN o.status_group = 'success' THEN o.revenue ELSE 0 END) AS collected_revenue,
  SUM(CASE WHEN o.status_group IN ('returned','returning') THEN o.revenue ELSE 0 END) AS returned_revenue,
  -- Costs
  SUM(o.shipping_fee + o.partner_fee) AS shipping_costs,
  SUM(o.return_fee) AS return_costs,
  -- Counts
  COUNT(*) AS total_orders,
  COUNTIF(o.status_group = 'success') AS success_orders,
  COUNTIF(o.status_group IN ('returned','returning')) AS returned_orders,
  SUM(o.total_quantity) AS total_items,
  -- Ads tracking
  COUNTIF(o.ad_id IS NOT NULL AND o.ad_id != '') AS orders_with_ads,
  COUNT(DISTINCT o.ad_id) AS distinct_ads,
  -- Rates
  SAFE_DIVIDE(
    COUNTIF(o.status_group IN ('returned','returning')),
    NULLIF(COUNT(*), 0)
  ) AS return_rate,
  SAFE_DIVIDE(SUM(o.revenue), NULLIF(COUNT(*), 0)) AS avg_order_value,
  SAFE_DIVIDE(
    COUNTIF(o.status_group = 'success'),
    NULLIF(COUNT(*), 0)
  ) AS success_rate
FROM `{PROJECT}.{DATASET}.vw_fact_orders` o
GROUP BY 1,2,3,4,5
;
