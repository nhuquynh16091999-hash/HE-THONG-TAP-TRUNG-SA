-- ╔══════════════════════════════════════════════════════════════╗
-- ║  Merge Staging → Main Tables (STRAMARK)                     ║
-- ║  Source of Truth: sql/stramark/merge_staging_orders.sql      ║
-- ║  Run AFTER each n8n sync batch                              ║
-- ╚══════════════════════════════════════════════════════════════╝
--
-- PATTERN: Delete-then-Insert (same as dev reference tl.docx)
-- Step 1: Delete from main table where id+shop_id exists in staging
-- Step 2: Insert all staging rows into main table
-- Step 3: Truncate staging table
--
-- WHY NOT MERGE: BQ MERGE has limitations with large tables and costs more.
-- Delete-Insert is simpler, cheaper, and idempotent.
--
-- USAGE: Run via Python script or n8n after each sync cycle.
-- Can be run multiple times safely (idempotent).

-- ═══════════════════════════════════════════════════
-- PART 1: Merge staging_sale_order → sale_order
-- ═══════════════════════════════════════════════════

-- Step 1: Delete existing rows that will be replaced
DELETE FROM `levelup-465304.STRAMARK_Dataset.sale_order`
WHERE CONCAT(id, '|', shop_id) IN (
  SELECT CONCAT(id, '|', shop_id)
  FROM `levelup-465304.STRAMARK_Dataset.staging_sale_order`
);

-- Step 2: Insert all staging data
INSERT INTO `levelup-465304.STRAMARK_Dataset.sale_order`
SELECT * FROM `levelup-465304.STRAMARK_Dataset.staging_sale_order`;

-- Step 3: Clear staging
TRUNCATE TABLE `levelup-465304.STRAMARK_Dataset.staging_sale_order`;


-- ═══════════════════════════════════════════════════
-- PART 2: Merge staging_order_items → order_items
-- ═══════════════════════════════════════════════════

-- Step 1: Delete existing rows
DELETE FROM `levelup-465304.STRAMARK_Dataset.order_items`
WHERE CONCAT(item_id, '|', shop_id) IN (
  SELECT CONCAT(item_id, '|', shop_id)
  FROM `levelup-465304.STRAMARK_Dataset.staging_order_items`
);

-- Step 2: Insert all staging data
INSERT INTO `levelup-465304.STRAMARK_Dataset.order_items`
SELECT * FROM `levelup-465304.STRAMARK_Dataset.staging_order_items`;

-- Step 3: Clear staging
TRUNCATE TABLE `levelup-465304.STRAMARK_Dataset.staging_order_items`;
