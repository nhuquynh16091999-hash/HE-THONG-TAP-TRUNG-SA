-- ═══════════════════════════════════════════════════
-- FIX: Update dim_marketer_mapping with correct campaign suffix codes
-- Date: 2026-03-04
-- Issue: Campaign names use suffix codes (Lệ, LC, TA, TÚ) at the END,
--        but dim_marketer_mapping.campaign_code may not match.
-- ═══════════════════════════════════════════════════

-- Step 1: Check current data
-- SELECT * FROM `levelup-465304.STRAMARK_Dataset.dim_marketer_mapping`;

-- Step 2: Update campaign_code for each marketer
-- Trần Cẩm Lệ → suffix "Lệ"
UPDATE `levelup-465304.STRAMARK_Dataset.dim_marketer_mapping`
SET campaign_code = 'Lệ'
WHERE marketer_id = 'LETC';

-- Phạm Thị Linh Chi → suffix "LC"
UPDATE `levelup-465304.STRAMARK_Dataset.dim_marketer_mapping`
SET campaign_code = 'LC'
WHERE marketer_id = 'CHIPTL';

-- Nguyễn Tuấn Anh → suffix "TA"
UPDATE `levelup-465304.STRAMARK_Dataset.dim_marketer_mapping`
SET campaign_code = 'TA'
WHERE marketer_id = 'ANHNT';

-- Kim Thanh Tú → suffix "TÚ"
UPDATE `levelup-465304.STRAMARK_Dataset.dim_marketer_mapping`
SET campaign_code = 'TÚ'
WHERE marketer_id = 'TUKT';

-- Step 3: Verify
SELECT marketer_id, marketer_name, campaign_code
FROM `levelup-465304.STRAMARK_Dataset.dim_marketer_mapping`
ORDER BY marketer_id;
