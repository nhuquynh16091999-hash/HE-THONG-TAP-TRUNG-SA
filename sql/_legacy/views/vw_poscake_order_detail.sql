-- vw_poscake_order_detail: Flat denormalized order + items view
-- Full order detail with line items, COGS, customer, and tracking
-- Usage: SELECT * FROM vw_poscake_order_detail WHERE project_id = 'STRAMARK' AND date >= '2026-02-01'

CREATE OR REPLACE VIEW `levelup-465304.FAOS_V2.vw_poscake_order_detail` AS

SELECT
    -- Order
    DATE(PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%E*S', o.inserted_at)) AS date,
    o.project_id,
    o.shop_name,
    o.id AS order_id,
    o.system_id,
    o.status,
    o.status_name,
    o.sub_status,
    -- Revenue
    o.cod,
    o.prepaid,
    o.cod + o.prepaid AS order_revenue,
    o.total_price,
    o.total_discount AS order_discount,
    o.money_to_collect,
    -- Costs
    o.shipping_fee,
    o.partner_fee,
    o.return_fee,
    o.fee_marketplace,
    o.surcharge,
    o.tax,
    o.shipping_fee + o.partner_fee + o.return_fee + o.fee_marketplace AS total_order_costs,
    -- Payment
    o.cash,
    o.transfer_money,
    o.charged_by_card,
    o.charged_by_momo,
    o.charged_by_qrpay,
    -- Customer
    o.customer_id,
    o.customer_name,
    o.bill_full_name,
    o.bill_phone_number,
    o.shipping_address,
    o.shipping_province,
    -- Item detail
    oi.item_id,
    oi.product_id,
    oi.product_name,
    oi.variation_id,
    oi.variation_name,
    oi.barcode,
    oi.quantity,
    oi.retail_price,
    oi.avg_imported_price AS unit_cogs,
    oi.quantity * oi.retail_price AS line_revenue,
    oi.quantity * oi.avg_imported_price AS line_cogs,
    oi.quantity * oi.retail_price - oi.quantity * oi.avg_imported_price AS line_profit,
    oi.discount_each_product AS item_discount,
    oi.return_quantity,
    oi.is_bonus_product,
    -- Attribution
    o.marketer,
    o.pke_mkter,
    o.ad_id,
    o.ads_source,
    o.p_utm_source,
    o.p_utm_campaign,
    o.p_utm_medium,
    o.order_sources_name,
    o.account_name,
    -- Fulfillment
    o.partner AS shipping_partner,
    o.tracking_link,
    o.warehouse_id,
    o.order_currency,
    o.is_exchange_order,
    -- Timestamps
    o.inserted_at AS order_created_at,
    o.updated_at AS order_updated_at,
    o.time_send_partner,
    o.note AS order_note
FROM `levelup-465304.{DATASET}.sale_order` o
LEFT JOIN `levelup-465304.{DATASET}.order_items` oi
    ON o.id = oi.order_id AND o.shop_id = oi.shop_id;
