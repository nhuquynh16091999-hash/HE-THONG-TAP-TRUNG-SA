-- ═══════════════════════════════════════════════════
-- MERGE staging → main tables (STRAMARK)
-- Source of Truth: sql/stramark/merge_staging_to_main.sql
-- Called by n8n workflow [STR] 03 Merge & Dedup
-- ═══════════════════════════════════════════════════

-- ─── STEP 1: MERGE staging_sale_order → sale_order ───
MERGE `levelup-465304.STRAMARK_Dataset.sale_order` T
USING `levelup-465304.STRAMARK_Dataset.staging_sale_order` S
ON T.id = S.id AND T.shop_id = S.shop_id
WHEN MATCHED THEN
  UPDATE SET
    T.status = S.status,
    T.status_name = S.status_name,
    T.total_price = S.total_price,
    T.shipping_fee = S.shipping_fee,
    T.cod = S.cod,
    T.total_discount = S.total_discount,
    T.partner_fee = S.partner_fee,
    T.return_fee = S.return_fee,
    T.surcharge = S.surcharge,
    T.money_to_collect = S.money_to_collect,
    T.total_quantity = S.total_quantity,
    T.updated_at = S.updated_at,
    T.time_send_partner = S.time_send_partner,
    T.estimate_delivery_date = S.estimate_delivery_date,
    T.tracking_link = S.tracking_link,
    T.tags = S.tags,
    T.note = S.note,
    T.sync_time = S.sync_time
WHEN NOT MATCHED THEN
  INSERT ROW;

-- ─── STEP 2: MERGE staging_order_items → order_items ───
-- Dedup key: item_id + order_id (unique pair)
MERGE `levelup-465304.STRAMARK_Dataset.order_items` T
USING (
  SELECT * FROM `levelup-465304.STRAMARK_Dataset.staging_order_items`
  QUALIFY ROW_NUMBER() OVER (PARTITION BY item_id, order_id ORDER BY sync_time DESC) = 1
) S
ON T.item_id = S.item_id AND T.order_id = S.order_id
WHEN MATCHED THEN
  UPDATE SET
    T.quantity = S.quantity,
    T.return_quantity = S.return_quantity,
    T.returned_count = S.returned_count,
    T.returning_quantity = S.returning_quantity,
    T.retail_price = S.retail_price,
    T.discount_each_product = S.discount_each_product,
    T.avg_imported_price = S.avg_imported_price,
    T.sync_time = S.sync_time
WHEN NOT MATCHED THEN
  INSERT ROW;

-- ─── STEP 3: TRUNCATE staging tables after merge ───
-- (Run separately — BigQuery doesn't support TRUNCATE in multi-statement)
-- TRUNCATE TABLE `levelup-465304.STRAMARK_Dataset.staging_sale_order`;
-- TRUNCATE TABLE `levelup-465304.STRAMARK_Dataset.staging_order_items`;
