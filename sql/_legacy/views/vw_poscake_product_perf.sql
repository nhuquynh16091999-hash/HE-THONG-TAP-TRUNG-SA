-- vw_poscake_product_perf: Product performance from Poscake data
-- Revenue, COGS, margin, return rate per product
-- Usage: SELECT * FROM vw_poscake_product_perf WHERE project_id = 'STRAMARK' ORDER BY revenue DESC

CREATE OR REPLACE VIEW `levelup-465304.FAOS_V2.vw_poscake_product_perf` AS

SELECT
    oi.project_id,
    oi.shop_name,
    oi.product_id,
    oi.product_name,
    oi.variation_name,
    oi.barcode,
    -- Volume
    SUM(oi.quantity) AS total_sold,
    SUM(oi.return_quantity + oi.returned_count) AS total_returned,
    -- Revenue
    SUM(oi.quantity * oi.retail_price) AS revenue,
    SUM(oi.quantity * oi.retail_price - oi.total_discount) AS revenue_after_discount,
    -- COGS
    SUM(oi.quantity * oi.avg_imported_price) AS cogs,
    AVG(oi.avg_imported_price) AS avg_cogs_per_unit,
    AVG(oi.retail_price) AS avg_retail_price,
    -- Profit
    SUM(oi.quantity * oi.retail_price - oi.total_discount)
        - SUM(oi.quantity * oi.avg_imported_price) AS gross_profit,
    SAFE_DIVIDE(
        SUM(oi.quantity * oi.retail_price - oi.total_discount) - SUM(oi.quantity * oi.avg_imported_price),
        NULLIF(SUM(oi.quantity * oi.retail_price - oi.total_discount), 0)
    ) AS gross_margin,
    -- Return rate
    SAFE_DIVIDE(
        SUM(oi.return_quantity + oi.returned_count),
        NULLIF(SUM(oi.quantity), 0)
    ) AS return_rate,
    -- Bonus/wholesale flags
    COUNTIF(oi.is_bonus_product) AS bonus_count,
    COUNTIF(oi.is_wholesale) AS wholesale_count,
    -- Orders
    COUNT(DISTINCT oi.order_id) AS order_count,
    MIN(oi.order_inserted_at) AS first_sold_at,
    MAX(oi.order_inserted_at) AS last_sold_at
FROM `levelup-465304.{DATASET}.order_items` oi
WHERE oi.avg_imported_price > 0  -- exclude items without COGS
GROUP BY 1, 2, 3, 4, 5, 6;
