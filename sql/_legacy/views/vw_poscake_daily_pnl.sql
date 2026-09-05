-- vw_poscake_daily_pnl: Daily P&L per project from Poscake data
-- Revenue = cod + prepaid
-- COGS from order_items.avg_imported_price
-- Returns tracked by status
-- Usage: SELECT * FROM vw_poscake_daily_pnl WHERE project_id = 'STRAMARK'

CREATE OR REPLACE VIEW `levelup-465304.FAOS_V2.vw_poscake_daily_pnl` AS

WITH daily_orders AS (
    SELECT
        DATE(PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%E*S', o.inserted_at)) AS date,
        o.project_id,
        o.shop_name,
        -- Revenue
        SUM(o.cod + o.prepaid) AS gross_revenue,
        SUM(CASE WHEN o.status_name IN ('delivered', 'received_money', 'packing', 'packed', 'shipping')
            THEN o.cod + o.prepaid ELSE 0 END) AS active_revenue,
        SUM(CASE WHEN o.status_name IN ('returned', 'returning')
            THEN o.cod + o.prepaid ELSE 0 END) AS returned_revenue,
        SUM(CASE WHEN o.status_name IN ('delivered', 'received_money')
            THEN o.cod + o.prepaid ELSE 0 END) AS collected_revenue,
        -- Costs from order
        SUM(o.shipping_fee) AS total_shipping_fee,
        SUM(o.partner_fee) AS total_partner_fee,
        SUM(o.return_fee) AS total_return_fee,
        SUM(o.fee_marketplace) AS total_marketplace_fee,
        SUM(o.surcharge) AS total_surcharge,
        SUM(o.tax) AS total_tax,
        SUM(o.total_discount) AS total_discount,
        -- Payment breakdown
        SUM(o.cash) AS total_cash,
        SUM(o.transfer_money) AS total_transfer,
        SUM(o.charged_by_card) AS total_card,
        SUM(o.charged_by_momo) AS total_momo,
        SUM(o.charged_by_qrpay) AS total_qrpay,
        -- Counts
        COUNT(*) AS total_orders,
        COUNTIF(o.status_name IN ('delivered', 'received_money')) AS delivered_orders,
        COUNTIF(o.status_name IN ('returned', 'returning')) AS returned_orders,
        COUNTIF(o.status_name = 'new') AS new_orders,
        COUNTIF(o.status_name IN ('packing', 'packed')) AS packing_orders,
        COUNTIF(o.status_name = 'shipping') AS shipping_orders,
        COUNTIF(o.status_name = 'cancelled') AS cancelled_orders,
        SUM(o.total_quantity) AS total_items_sold
    FROM `levelup-465304.{DATASET}.sale_order` o
    GROUP BY 1, 2, 3
),

daily_cogs AS (
    SELECT
        DATE(PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%E*S', oi.order_inserted_at)) AS date,
        oi.project_id,
        oi.shop_name,
        SUM(oi.quantity * oi.avg_imported_price) AS total_cogs,
        SUM(oi.quantity * oi.retail_price) AS total_retail_value,
        SUM(oi.quantity) AS total_units,
        SUM(oi.return_quantity * oi.avg_imported_price) AS returned_cogs
    FROM `levelup-465304.{DATASET}.order_items` oi
    GROUP BY 1, 2, 3
)

SELECT
    o.date,
    o.project_id,
    o.shop_name,
    -- Revenue
    o.gross_revenue,
    o.active_revenue,
    o.collected_revenue,
    o.returned_revenue,
    -- COGS
    COALESCE(c.total_cogs, 0) AS cogs,
    COALESCE(c.returned_cogs, 0) AS returned_cogs,
    -- Costs
    o.total_shipping_fee,
    o.total_partner_fee,
    o.total_return_fee,
    o.total_marketplace_fee,
    o.total_surcharge + o.total_tax AS other_costs,
    o.total_discount,
    -- Profit calculations
    o.gross_revenue - COALESCE(c.total_cogs, 0) AS gross_profit,
    o.gross_revenue - COALESCE(c.total_cogs, 0) - o.total_shipping_fee
        - o.total_partner_fee - o.total_return_fee
        - o.total_marketplace_fee AS operating_profit,
    -- Margins
    SAFE_DIVIDE(o.gross_revenue - COALESCE(c.total_cogs, 0), NULLIF(o.gross_revenue, 0)) AS gross_margin,
    SAFE_DIVIDE(o.returned_revenue, NULLIF(o.gross_revenue, 0)) AS return_rate_revenue,
    -- Payment breakdown
    o.total_cash, o.total_transfer, o.total_card, o.total_momo, o.total_qrpay,
    -- Counts
    o.total_orders, o.delivered_orders, o.returned_orders,
    o.new_orders, o.packing_orders, o.shipping_orders, o.cancelled_orders,
    o.total_items_sold,
    SAFE_DIVIDE(o.returned_orders, NULLIF(o.total_orders, 0)) AS return_rate_orders,
    SAFE_DIVIDE(o.gross_revenue, NULLIF(o.total_orders, 0)) AS avg_order_value
FROM daily_orders o
LEFT JOIN daily_cogs c
    ON o.date = c.date AND o.project_id = c.project_id AND o.shop_name = c.shop_name;
