-- ============================================================
-- vw_fact_marketing_perf — Campaign Performance View
-- Owner: G3 (Marketing Analyst)
-- Rewritten for actual BQ schema (fb_ads_data table)
-- ============================================================
-- Source: fb_ads_data (6,986 rows, 18 columns)
-- NOTE: This table contains MESSAGING metrics, not purchase/ROAS.
-- Available: spend, impressions, reach, messaging conversations
-- NOT available: purchases, revenue, clicks, frequency, video views
-- ============================================================

CREATE OR REPLACE VIEW `{PROJECT}.{DATASET}.vw_fact_marketing_perf` AS

-- Map page_id → shop_id from orders (most reliable — every order has both)
WITH page_shop_map AS (
  SELECT
    page_id,
    ARRAY_AGG(shop_id ORDER BY cnt DESC LIMIT 1)[SAFE_OFFSET(0)] AS shop_id,
  FROM (
    SELECT page_id, shop_id, COUNT(*) as cnt
    FROM `{PROJECT}.{DATASET}.sale_order`
    WHERE page_id IS NOT NULL AND page_id != ''
      AND shop_id IS NOT NULL AND shop_id != ''
    GROUP BY page_id, shop_id
  )
  GROUP BY page_id
)

SELECT
  fb.date AS ad_date,
  fb.campaign_id,
  cl.campaign_name,
  fb.ad_id,
  fb.ad_name,
  fb.adset_id,
  'facebook' AS platform,
  fb.page_id,
  COALESCE(psm.shop_id, '') AS shop_id,
  fb.status AS ad_status,
  
  -- Spend & Reach
  COALESCE(fb.spend, 0) AS spend,
  COALESCE(fb.impressions, 0) AS impressions,
  COALESCE(fb.reach, 0) AS reach,
  
  -- Messaging Metrics (specific to this data source)
  COALESCE(fb.messaging_conversation_started, 0) AS conversations_started,
  COALESCE(fb.messaging_conversation_replies, 0) AS conversation_replies,
  COALESCE(fb.new_messaging_contacts, 0) AS new_contacts,
  COALESCE(fb.total_messaging_contacts, 0) AS total_contacts,
  COALESCE(fb.welcome_message_views, 0) AS welcome_views,
  COALESCE(fb.blocks, 0) AS blocks,
  
  -- Computed Metrics
  SAFE_DIVIDE(fb.spend, NULLIF(fb.reach, 0)) AS cost_per_reach,
  SAFE_DIVIDE(fb.spend * 1000, NULLIF(fb.impressions, 0)) AS cpm,
  fb.cost_per_result,
  
  -- Conversation Rate (conversations / reach)
  SAFE_DIVIDE(
    COALESCE(fb.messaging_conversation_started, 0),
    NULLIF(fb.reach, 0)
  ) AS conversation_rate,
  
  -- Cost per Conversation
  SAFE_DIVIDE(
    fb.spend,
    NULLIF(COALESCE(fb.messaging_conversation_started, 0), 0)
  ) AS cost_per_conversation,
  
  -- Block Rate (negative signal)
  SAFE_DIVIDE(
    COALESCE(fb.blocks, 0),
    NULLIF(COALESCE(fb.messaging_conversation_started, 0), 0)
  ) AS block_rate,

FROM `{PROJECT}.{DATASET}.fb_ads_data` fb
LEFT JOIN `{PROJECT}.{DATASET}.campaign_list` cl 
  ON fb.campaign_id = cl.campaign_id
LEFT JOIN page_shop_map psm
  ON fb.page_id = psm.page_id;
