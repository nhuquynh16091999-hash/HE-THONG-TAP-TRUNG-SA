-- ═══════════════════════════════════════════════════════════════════
-- FAOS v6 — ai_pattern_library
-- ═══════════════════════════════════════════════════════════════════
-- Purpose: Stores validated advertising patterns for audit trail
--          and dashboard analytics. Dual-write with FalkorDB.
--
-- A pattern is validated after ≥ 3 occurrences.
-- Patterns are extracted daily during reflection phase.
--
-- Dataset: Replace {DATASET} with STRAMARK_Dataset / etc.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS `levelup-465304.{DATASET}.ai_pattern_library` (
  -- ═══ IDENTITY ═══
  pattern_id STRING NOT NULL,
  description STRING NOT NULL,
  pattern_type STRING NOT NULL,            -- CREATIVE | AUDIENCE | MARKET | FUNNEL | TIMING

  -- ═══ DIMENSIONS ═══
  creative_type STRING,                     -- VIDEO | IMAGE | CAROUSEL
  market STRING,                            -- Romania | Bulgaria | ...
  age_range STRING,                         -- 18-24 | 25-34 | ...
  gender STRING,                            -- ALL | MALE | FEMALE
  metric_name STRING,                       -- hook_rate | frequency | ctr | ...
  metric_threshold FLOAT64,                 -- threshold value for this pattern
  outcome STRING,                           -- WIN | FAIL

  -- ═══ VALIDATION ═══
  confidence STRING DEFAULT 'LOW',          -- LOW | MEDIUM | HIGH
  occurrences INT64 DEFAULT 1,
  validated BOOL DEFAULT FALSE,             -- TRUE when occurrences ≥ 3
  source_campaign_ids ARRAY<STRING>,        -- campaign IDs that contributed

  -- ═══ METADATA ═══
  first_seen DATE,
  last_seen DATE,
  project_id STRING NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP(),
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
)
CLUSTER BY project_id, pattern_type
OPTIONS (
  description = 'FAOS v6 — Validated advertising patterns (audit trail + analytics)'
);
