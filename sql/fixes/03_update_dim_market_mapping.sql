-- ═══════════════════════════════════════════════════
-- FIX: Ensure dim_market_mapping has entries for all STRAMARK markets
-- Date: 2026-03-25
-- Issue: Bulgaria & Slovakia campaigns show 0 ads_spend because
--        dim_market_mapping may lack entries for BG/SK raw values.
-- ═══════════════════════════════════════════════════

-- Step 1: Check current data
-- SELECT * FROM `levelup-465304.STRAMARK_Dataset.dim_market_mapping`;

-- Step 2: Insert missing entries (MERGE to avoid duplicates)
MERGE `levelup-465304.STRAMARK_Dataset.dim_market_mapping` AS t
USING (
    SELECT 'ro' AS raw_market, 'Romania' AS market_name UNION ALL
    SELECT 'RO', 'Romania' UNION ALL
    SELECT 'romania', 'Romania' UNION ALL
    SELECT 'bg', 'Bulgaria' UNION ALL
    SELECT 'BG', 'Bulgaria' UNION ALL
    SELECT 'bulgaria', 'Bulgaria' UNION ALL
    SELECT 'sk', 'Slovakia' UNION ALL
    SELECT 'SK', 'Slovakia' UNION ALL
    SELECT 'slovakia', 'Slovakia' UNION ALL
    SELECT 'hr', 'Croatia' UNION ALL
    SELECT 'HR', 'Croatia' UNION ALL
    SELECT 'croatia', 'Croatia'
) AS s
ON LOWER(t.raw_market) = LOWER(s.raw_market)
WHEN NOT MATCHED THEN
    INSERT (raw_market, market_name)
    VALUES (s.raw_market, s.market_name);

-- Step 3: Verify
SELECT raw_market, market_name
FROM `levelup-465304.STRAMARK_Dataset.dim_market_mapping`
ORDER BY market_name, raw_market;
