-- ═══════════════════════════════════════════════════
-- fact_order_items_dedup v4 — Clean order items
-- Source of Truth: sql/stramark/01_fact_order_items_dedup.sql
-- DO NOT modify via Python scripts
-- ═══════════════════════════════════════════════════
-- v4 CHANGES (2026-03-20):
--   1. FIX: retail_price fallback to sale_order.total_price/total_quantity
--      when retail_price = 0 (POS sync gap)
--   2. line_revenue and margin now use fallback price
-- Note: order_items columns are now FLOAT/INT (migrated from STRING)
-- ═══════════════════════════════════════════════════

CREATE OR REPLACE VIEW `levelup-465304.STRAMARK_Dataset.fact_order_items_dedup` AS
SELECT
    oi.item_id, oi.order_id, oi.shop_id, oi.shop_name, oi.project_id,
    oi.product_id, oi.variation_id, oi.product_name, oi.variation_name, oi.barcode,
    SAFE_CAST(oi.quantity AS INT64) AS quantity,
    SAFE_CAST(oi.return_quantity AS INT64) AS return_quantity,
    -- Fallback: if retail_price = 0 (POS sync gap), use order-level total_price/total_quantity
    COALESCE(
        NULLIF(ROUND(SAFE_CAST(oi.retail_price AS FLOAT64) / 100, 2), 0),
        ROUND(SAFE_DIVIDE(SAFE_CAST(os.total_price AS FLOAT64), SAFE_CAST(os.total_quantity AS FLOAT64)) / 100, 2)
    ) AS retail_price,
    ROUND(SAFE_CAST(oi.discount_each_product AS FLOAT64) / 100, 2) AS discount_each_product,
    ROUND(SAFE_CAST(oi.avg_imported_price AS FLOAT64) / 100, 2) AS avg_imported_price,
    SAFE_CAST(oi.is_bonus_product AS BOOL) AS is_bonus_product,
    SAFE.PARSE_DATE('%Y-%m-%d', LEFT(oi.order_inserted_at, 10)) AS order_date,
    oi.order_inserted_at, oi.sync_time,

    -- Order status
    SAFE_CAST(os.status AS INT64) AS order_status,

    -- Margin (uses effective retail_price with fallback)
    ROUND(
        COALESCE(NULLIF(SAFE_CAST(oi.retail_price AS FLOAT64), 0), SAFE_DIVIDE(SAFE_CAST(os.total_price AS FLOAT64), SAFE_CAST(os.total_quantity AS FLOAT64)))/100
        - SAFE_CAST(oi.avg_imported_price AS FLOAT64)/100
    , 2) AS margin_per_unit,
    ROUND(SAFE_DIVIDE(
        COALESCE(NULLIF(SAFE_CAST(oi.retail_price AS FLOAT64), 0), SAFE_DIVIDE(SAFE_CAST(os.total_price AS FLOAT64), SAFE_CAST(os.total_quantity AS FLOAT64)))
        - SAFE_CAST(oi.avg_imported_price AS FLOAT64),
        NULLIF(COALESCE(NULLIF(SAFE_CAST(oi.retail_price AS FLOAT64), 0), SAFE_DIVIDE(SAFE_CAST(os.total_price AS FLOAT64), SAFE_CAST(os.total_quantity AS FLOAT64))), 0)
    ) * 100, 1) AS margin_pct,

    -- COGS & Revenue
    ROUND(SAFE_CAST(oi.quantity AS FLOAT64) * SAFE_CAST(oi.avg_imported_price AS FLOAT64) / 100, 2) AS line_cogs,
    CASE
        WHEN SAFE_CAST(oi.is_bonus_product AS BOOL) = TRUE THEN 0
        ELSE ROUND(SAFE_CAST(oi.quantity AS FLOAT64) * (
            COALESCE(NULLIF(SAFE_CAST(oi.retail_price AS FLOAT64), 0), SAFE_DIVIDE(SAFE_CAST(os.total_price AS FLOAT64), SAFE_CAST(os.total_quantity AS FLOAT64)))
            - COALESCE(SAFE_CAST(oi.discount_each_product AS FLOAT64), 0)
        ) / 100, 2)
    END AS line_revenue

FROM `levelup-465304.STRAMARK_Dataset.order_items` oi
LEFT JOIN `levelup-465304.STRAMARK_Dataset.sale_order` os ON oi.order_id = os.id AND oi.shop_id = os.shop_id
;
