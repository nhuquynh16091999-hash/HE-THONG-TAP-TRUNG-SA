-- ============================================================
-- dim_country_payment — Country → Payment Model Mapping
-- ============================================================
-- Purpose: Auto-detect payment model (COD/PREPAID) per country
-- Used by: vw_sale_order_standard, vw_fact_daily_pnl_flex
-- Deploy: All datasets
-- ============================================================

CREATE TABLE IF NOT EXISTS `levelup-465304.{DATASET}.dim_country_payment` (
  country_code            STRING    NOT NULL,   -- ISO2: RO, BG, US, AU, KR...
  country_name            STRING    NOT NULL,
  payment_model           STRING    NOT NULL,   -- 'COD' | 'PREPAID'
  region                  STRING    NOT NULL,   -- EU, MIDDLE_EAST, ASIA, NA, OCEANIA
  currency                STRING    NOT NULL,   -- RON, BGN, USD, AUD, KRW...
  requires_dual_roas      BOOL      NOT NULL    -- TRUE = COD (prov ≠ confirmed)
);

-- Seed data
DELETE FROM `levelup-465304.{DATASET}.dim_country_payment` WHERE TRUE;

INSERT INTO `levelup-465304.{DATASET}.dim_country_payment`
  (country_code, country_name, payment_model, region, currency, requires_dual_roas)
VALUES
  -- EU — COD
  ('RO', 'Romania',       'COD',     'EU',          'RON', TRUE),
  ('BG', 'Bulgaria',      'COD',     'EU',          'BGN', TRUE),
  ('SK', 'Slovakia',      'COD',     'EU',          'EUR', TRUE),
  ('HU', 'Hungary',       'COD',     'EU',          'HUF', TRUE),
  ('HR', 'Croatia',       'COD',     'EU',          'EUR', TRUE),
  ('CZ', 'Czech Republic','COD',     'EU',          'CZK', TRUE),
  ('PL', 'Poland',        'COD',     'EU',          'PLN', TRUE),

  -- Middle East — COD
  ('SA', 'Saudi Arabia',  'COD',     'MIDDLE_EAST', 'SAR', TRUE),
  ('AE', 'UAE',           'COD',     'MIDDLE_EAST', 'AED', TRUE),
  ('OM', 'Oman',          'COD',     'MIDDLE_EAST', 'OMR', TRUE),
  ('KW', 'Kuwait',        'COD',     'MIDDLE_EAST', 'KWD', TRUE),
  ('QA', 'Qatar',         'COD',     'MIDDLE_EAST', 'QAR', TRUE),
  ('BH', 'Bahrain',       'COD',     'MIDDLE_EAST', 'BHD', TRUE),

  -- Asia — Mixed
  ('JP', 'Japan',         'COD',     'ASIA',        'JPY', TRUE),
  ('TW', 'Taiwan',        'COD',     'ASIA',        'TWD', TRUE),
  ('KR', 'Korea',         'PREPAID', 'ASIA',        'KRW', FALSE),

  -- NA — Prepaid
  ('US', 'USA',           'PREPAID', 'NA',          'USD', FALSE),
  ('CA', 'Canada',        'PREPAID', 'NA',          'CAD', FALSE),

  -- Oceania — Prepaid
  ('AU', 'Australia',     'PREPAID', 'OCEANIA',     'AUD', FALSE),
  ('NZ', 'New Zealand',   'PREPAID', 'OCEANIA',     'NZD', FALSE);
