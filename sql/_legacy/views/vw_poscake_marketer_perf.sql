-- vw_poscake_marketer_perf: Marketer performance from Poscake data
-- Tracks orders, revenue, COGS, profit per marketer + ad attribution
-- Usage: SELECT * FROM vw_poscake_marketer_perf WHERE project_id = 'STRAMARK'

CREATE OR REPLACE VIEW `levelup-465304.FAOS_V2.vw_poscake_marketer_perf` AS

WITH marketer_orders AS (
    SELECT
        DATE(PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%E*S', o.inserted_at)) AS date,
        o.project_id,
        o.shop_name,
        COALESCE(NULLIF(o.marketer, ''), NULLIF(o.pke_mkter, ''), 'Unknown') AS marketer_id,
        o.account_name,
        -- Revenue
        SUM(o.cod + o.prepaid) AS gross_revenue,
        SUM(CASE WHEN o.status_name IN ('delivered', 'received_money')
            THEN o.cod + o.prepaid ELSE 0 END) AS collected_revenue,
        SUM(CASE WHEN o.status_name IN ('returned', 'returning')
            THEN o.cod + o.prepaid ELSE 0 END) AS returned_revenue,
        -- Costs
        SUM(o.shipping_fee + o.partner_fee) AS shipping_costs,
        SUM(o.return_fee) AS return_costs,
        -- Counts
        COUNT(*) AS total_orders,
        COUNTIF(o.status_name IN ('delivered', 'received_money')) AS delivered_orders,
        COUNTIF(o.status_name IN ('returned', 'returning')) AS returned_orders,
        SUM(o.total_quantity) AS total_items,
        -- Ads tracking
        COUNTIF(o.ad_id IS NOT NULL AND o.ad_id != '') AS orders_with_ads,
        COUNT(DISTINCT o.ad_id) AS distinct_ads
    FROM `levelup-465304.{DATASET}.sale_order` o
    GROUP BY 1, 2, 3, 4, 5
),

marketer_cogs AS (
    SELECT
        DATE(PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%E*S', oi.order_inserted_at)) AS date,
        oi.project_id,
        oi.shop_name,
        -- Join with sale_order to get marketer
        COALESCE(NULLIF(o.marketer, ''), NULLIF(o.pke_mkter, ''), 'Unknown') AS marketer_id,
        SUM(oi.quantity * oi.avg_imported_price) AS total_cogs
    FROM `levelup-465304.{DATASET}.order_items` oi
    JOIN `levelup-465304.{DATASET}.sale_order` o
        ON oi.order_id = o.id AND oi.shop_id = o.shop_id
    GROUP BY 1, 2, 3, 4
)

SELECT
    m.date,
    m.project_id,
    m.shop_name,
    m.marketer_id,
    m.account_name,
    m.gross_revenue,
    m.collected_revenue,
    m.returned_revenue,
    COALESCE(c.total_cogs, 0) AS cogs,
    m.shipping_costs,
    m.return_costs,
    -- Profit
    m.gross_revenue - COALESCE(c.total_cogs, 0) AS gross_profit,
    m.gross_revenue - COALESCE(c.total_cogs, 0) - m.shipping_costs - m.return_costs AS net_profit,
    -- Margins
    SAFE_DIVIDE(m.gross_revenue - COALESCE(c.total_cogs, 0), NULLIF(m.gross_revenue, 0)) AS gross_margin,
    -- Counts
    m.total_orders,
    m.delivered_orders,
    m.returned_orders,
    m.total_items,
    m.orders_with_ads,
    m.distinct_ads,
    -- Rates
    SAFE_DIVIDE(m.returned_orders, NULLIF(m.total_orders, 0)) AS return_rate,
    SAFE_DIVIDE(m.gross_revenue, NULLIF(m.total_orders, 0)) AS avg_order_value
FROM marketer_orders m
LEFT JOIN marketer_cogs c
    ON m.date = c.date AND m.project_id = c.project_id
    AND m.shop_name = c.shop_name AND m.marketer_id = c.marketer_id;
