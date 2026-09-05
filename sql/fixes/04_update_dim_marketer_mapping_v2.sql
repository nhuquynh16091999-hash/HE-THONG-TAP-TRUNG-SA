-- ═══════════════════════════════════════════════════
-- FIX: Add missing campaign_code for Minh Thư, Tường Vân, Hiệu
-- Date: 2026-03-25
-- Issue: 01_update_dim_marketer_mapping.sql only updated 4/7 marketers.
--        Missing: MINHTHU, TUONGVAN, HIEUNV — their ads show 0 spend.
-- ═══════════════════════════════════════════════════

-- Step 1: Check current data
-- SELECT * FROM `levelup-465304.STRAMARK_Dataset.dim_marketer_mapping`;

-- Step 2: Update campaign_code for missing marketers
-- Đỗ Minh Thư → suffix "MT"
UPDATE `levelup-465304.STRAMARK_Dataset.dim_marketer_mapping`
SET campaign_code = 'MT'
WHERE marketer_id = 'MINHTHU';

-- Phạm Thị Tường Vân → suffix "Vân"
UPDATE `levelup-465304.STRAMARK_Dataset.dim_marketer_mapping`
SET campaign_code = 'Vân'
WHERE marketer_id = 'TUONGVAN';

-- Nguyễn Văn Hiệu → suffix "Hiệu"
UPDATE `levelup-465304.STRAMARK_Dataset.dim_marketer_mapping`
SET campaign_code = 'Hiệu'
WHERE marketer_id = 'HIEUNV';

-- Step 3: Verify
SELECT marketer_id, marketer_name, campaign_code
FROM `levelup-465304.STRAMARK_Dataset.dim_marketer_mapping`
ORDER BY marketer_id;
