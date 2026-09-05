-- ═══════════════════════════════════════════════════
-- fact_order_items_dedup — Clean order items (AUUS1)
-- Source of Truth: sql/auus1/01_fact_order_items_dedup.sql
-- Adapted from Stramark template for AUUS1_Dataset
-- ═══════════════════════════════════════════════════
-- All columns in order_items are STRING type (n8n legacy)
-- → ALL numeric fields use SAFE_CAST()
-- POS price divisor: 100 (same as Stramark)
-- ═══════════════════════════════════════════════════

CREATE OR REPLACE VIEW `levelup-465304.AUUS1_Dataset.fact_order_items_dedup` AS
SELECT
    oi.item_id, oi.order_id, oi.shop_id, oi.shop_name, oi.project_id,
    oi.product_id, oi.variation_id, oi.product_name, oi.variation_name, oi.barcode,
    SAFE_CAST(oi.quantity AS INT64) AS quantity,
    SAFE_CAST(oi.return_quantity AS INT64) AS return_quantity,
    ROUND(SAFE_CAST(oi.retail_price AS FLOAT64) / 100, 2) AS retail_price,
    ROUND(SAFE_CAST(oi.discount_each_product AS FLOAT64) / 100, 2) AS discount_each_product,
    ROUND(SAFE_CAST(oi.avg_imported_price AS FLOAT64) / 100, 2) AS avg_imported_price,
    SAFE_CAST(oi.is_bonus_product AS BOOL) AS is_bonus_product,
    SAFE.PARSE_DATE('%Y-%m-%d', LEFT(oi.order_inserted_at, 10)) AS order_date,
    oi.order_inserted_at, oi.sync_time,
    
    -- Order status (CAST to STRING for AUUS1 compatibility — n8n stores as STRING)
    SAFE_CAST(os.status AS STRING) AS order_status,
    
    -- Margin
    ROUND(SAFE_CAST(oi.retail_price AS FLOAT64)/100 - SAFE_CAST(oi.avg_imported_price AS FLOAT64)/100, 2) AS margin_per_unit,
    ROUND(SAFE_DIVIDE(
        SAFE_CAST(oi.retail_price AS FLOAT64) - SAFE_CAST(oi.avg_imported_price AS FLOAT64),
        NULLIF(SAFE_CAST(oi.retail_price AS FLOAT64), 0)
    ) * 100, 1) AS margin_pct,
    
    -- COGS & Revenue
    ROUND(SAFE_CAST(oi.quantity AS FLOAT64) * SAFE_CAST(oi.avg_imported_price AS FLOAT64) / 100, 2) AS line_cogs,
    CASE 
        WHEN SAFE_CAST(oi.is_bonus_product AS BOOL) = TRUE THEN 0
        ELSE ROUND(SAFE_CAST(oi.quantity AS FLOAT64) * (SAFE_CAST(oi.retail_price AS FLOAT64) - COALESCE(SAFE_CAST(oi.discount_each_product AS FLOAT64), 0)) / 100, 2)
    END AS line_revenue

FROM `levelup-465304.AUUS1_Dataset.order_items` oi
LEFT JOIN `levelup-465304.AUUS1_Dataset.sale_order` os ON oi.order_id = os.id AND oi.shop_id = os.shop_id
;
