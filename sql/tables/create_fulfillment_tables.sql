-- ══════════════════════════════════════════════════════════
-- T1 Fulfillment Tables
-- Usage: Replace {PROJECT} and {DATASET} before running
-- Market: Slovakia (SK) | 3PL: euShipments
-- ══════════════════════════════════════════════════════════

-- 1. fulfillment_orders — Mỗi đơn đã gửi/thử gửi 3PL
CREATE TABLE IF NOT EXISTS `{PROJECT}.{DATASET}.fulfillment_orders` (
    -- Identity
    pos_order_id STRING NOT NULL,         -- POS Cake order ID (unique key)
    tpl_order_id INT64,                   -- euShipments internal order ID
    awb STRING,                           -- Air Waybill / Tracking number

    -- Courier & Warehouse
    courier_name STRING,                  -- e.g., "Slovakia GLS"
    courier_id INT64,                     -- euShipments courier ID (741)
    warehouse STRING DEFAULT 'HelpShip Oradea',

    -- Recipient
    recipient_name STRING,
    recipient_phone STRING,
    recipient_city STRING,
    recipient_country STRING DEFAULT 'SK',

    -- Financial
    cod_amount FLOAT64,                   -- COD thu hộ (original currency)
    shipping_cost_eur FLOAT64,            -- Chi phí ship (EUR)
    ffm_cost_eur FLOAT64,                -- Chi phí fulfillment (EUR)
    total_3pl_cost_eur FLOAT64,          -- Tổng chi phí 3PL (EUR)

    -- Items
    items_count INT64,
    weight_kg FLOAT64,

    -- Status tracking
    status STRING DEFAULT 'created',      -- created/shipped/delivered/returned/cancelled/validation_failed
    last_status_update TIMESTAMP,
    error_message STRING,
    warnings STRING,

    -- Metadata
    is_test BOOL DEFAULT TRUE,
    shop_id STRING,
    project_id STRING DEFAULT 't1',
    created_at STRING,
    sync_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
);


-- 2. fulfillment_tracking — Lịch sử tracking events
CREATE TABLE IF NOT EXISTS `{PROJECT}.{DATASET}.fulfillment_tracking` (
    pos_order_id STRING NOT NULL,
    tpl_order_id INT64,
    awb STRING,

    -- Event
    status STRING,                        -- shipped/in_transit/delivered/returned/etc.
    status_detail STRING,                 -- Chi tiết trạng thái
    event_timestamp TIMESTAMP,
    location STRING,

    -- Metadata
    synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
);
