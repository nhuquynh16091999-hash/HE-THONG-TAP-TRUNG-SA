-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  REAL PERFORMANCE REPORT — "Hiệu quả Quảng cáo Thực tế"           ║
-- ║  Chief Data Auditor Test Case                                       ║
-- ║  Proof: Database architecture can answer Marketing's #1 question    ║
-- ╚══════════════════════════════════════════════════════════════════════╝
--
-- DATA LINEAGE:
--   Poscake API → staging_sale_order → MERGE → sale_order
--                                                ↓
--   Meta API → fb_ads_data ─────────────► vw_fact_orders (attributed)
--   Meta API → fb_adset_data ───────────┘        ↓
--   Config   → page_marketer  ──────────┘   THIS QUERY
--   Config   → dim_marketer_mapping ────┘
--
-- JOIN KEYS (4-level attribution, already resolved in vw_fact_orders):
--   Level 1: sale_order.p_utm_term = fb_ads_data.ad_id       (AD_MATCH)
--   Level 2: sale_order.p_utm_medium = fb_adset_data.adset_id (ADSET_MATCH)  
--   Level 3: sale_order.ads_source = fb_ads_data.campaign_name (TEXT_MATCH)
--   Level 4: sale_order.page_id = page_marketer.page_id       (PAGE_MATCH)
--
-- CURRENCY: STRAMARK values in bani (÷100 already done in vw_fact_orders)
-- ROAS: Revenue in RON, Ads in USD → convert RON→USD with rate 4.55

-- ═══════════════════════════════════════════════════
-- CTE 1: Orders — From our attributed view
-- ═══════════════════════════════════════════════════
WITH orders_attributed AS (
    SELECT
        -- Identity
        o.order_id,
        o.shop_id,
        o.order_date,
        
        -- Marketer (4-level priority already resolved in view)
        o.marketer_id,
        o.marketer_name,
        o.marketer_source,          -- PAGE_MATCH / DIM_MATCH / RAW_FIELD / UNKNOWN
        
        -- Attribution (already resolved in view)
        o.attribution_type,         -- AD_MATCH / ADSET_MATCH / ORGANIC_FB / UNKNOWN
        o.matched_campaign_name,
        o.matched_campaign_id,
        o.resolved_ad_id,
        o.resolved_adset_id,
        
        -- Market / Product (derived from campaign name parsing)
        o.derived_market,
        o.derived_market_code,
        o.derived_product_code,
        
        -- Combo (NEW — product attribution via combo system)
        o.combo_name,
        
        -- Status
        o.status_code,
        o.status_group,
        
        -- Revenue (already ÷100 in view)
        o.cod,                      -- Actual cash collected
        o.total_price,              -- Gross order value
        o.shipping_fee,             -- Shipping cost
        o.partner_fee,              -- 3PL fee
        o.return_fee,               -- Return cost
        
        -- Revenue tiers
        o.revenue_L2_shipped,       -- Shipped orders revenue (status 2,3,16)
        o.revenue_L3_success        -- Success orders revenue (status 3,16)
        
    FROM `levelup-465304.STRAMARK_Dataset.vw_fact_orders` o
    WHERE o.order_date = DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY)  -- Yesterday
),

-- ═══════════════════════════════════════════════════
-- CTE 2: Ads Spend — Ad-level daily (deduped)
-- ═══════════════════════════════════════════════════
ads_daily AS (
    SELECT
        campaign_id,
        campaign_name,
        SAFE.PARSE_DATE('%Y-%m-%d', date) AS ads_date,
        SUM(SAFE_CAST(spend AS FLOAT64)) AS total_spend_usd,
        SUM(SAFE_CAST(impressions AS INT64)) AS total_impressions,
        SUM(SAFE_CAST(reach AS INT64)) AS total_reach,
        SUM(SAFE_CAST(clicks AS INT64)) AS total_clicks
    FROM (
        SELECT *, ROW_NUMBER() OVER(
            PARTITION BY ad_id, date, account_id 
            ORDER BY sync_time DESC
        ) AS rn
        FROM `levelup-465304.STRAMARK_Dataset.fb_ads_data`
    )
    WHERE rn = 1
      AND date = FORMAT_DATE('%Y-%m-%d', DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY))
    GROUP BY campaign_id, campaign_name, date
),

-- ═══════════════════════════════════════════════════
-- CTE 3: Adset Spend — For orders matched via adset_id
-- ═══════════════════════════════════════════════════
adset_daily AS (
    SELECT
        adset_id,
        adset_name,
        campaign_id,
        campaign_name,
        SAFE.PARSE_DATE('%Y-%m-%d', date) AS ads_date,
        SUM(spend) AS total_spend_usd,
        SUM(impressions) AS total_impressions,
        SUM(clicks) AS total_clicks
    FROM `levelup-465304.STRAMARK_Dataset.fb_adset_data`
    WHERE date = FORMAT_DATE('%Y-%m-%d', DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY))
    GROUP BY adset_id, adset_name, campaign_id, campaign_name, date
),

-- ═══════════════════════════════════════════════════
-- CTE 4: Aggregate Orders by Campaign + Marketer
-- ═══════════════════════════════════════════════════
order_metrics AS (
    SELECT
        -- Grouping dimensions
        COALESCE(o.marketer_name, 'Unknown') AS marketer,
        COALESCE(o.matched_campaign_name, 'No Campaign') AS campaign_name,
        COALESCE(o.matched_campaign_id, 'N/A') AS campaign_id,
        COALESCE(o.derived_product_code, o.combo_name, 'Unknown Product') AS product,
        COALESCE(o.derived_market, 'Unknown Market') AS market,
        'STRAMARK' AS project,
        o.attribution_type,
        
        -- Order metrics
        COUNT(DISTINCT o.order_id) AS total_orders,
        
        -- L2 Revenue: Shipped + Delivered (status 2,3,16) → "Đã xác nhận" + "Đang giao"
        -- This is "Real Revenue" as requested: confirmed orders, excluding canceled/junk
        ROUND(SUM(o.revenue_L2_shipped), 2) AS real_revenue_ron,
        
        -- L3 Revenue: Success only (status 3,16) — for P&L
        ROUND(SUM(o.revenue_L3_success), 2) AS success_revenue_ron,
        
        -- Costs
        ROUND(SUM(CASE WHEN o.status_code IN (2,3,16) 
            THEN o.shipping_fee ELSE 0 END), 2) AS shipping_cost_ron,
        ROUND(SUM(CASE WHEN o.status_code IN (2,3,16) 
            THEN o.partner_fee ELSE 0 END), 2) AS partner_fee_ron,
        
        -- For adset-level spend matching
        MAX(o.resolved_adset_id) AS sample_adset_id
        
    FROM orders_attributed o
    GROUP BY 1, 2, 3, 4, 5, 6, 7
)

-- ═══════════════════════════════════════════════════
-- FINAL: Join Orders ↔ Ads (via campaign_id or adset_id)
-- ═══════════════════════════════════════════════════
SELECT
    -- === WHO & WHERE ===
    om.marketer,
    om.market,
    om.project,
    om.product,
    
    -- === CAMPAIGN ===
    om.campaign_name,
    om.campaign_id,
    om.attribution_type,
    
    -- === ADS METRICS (USD) ===
    COALESCE(ad.total_spend_usd, asd.total_spend_usd, 0) AS ad_spend_usd,
    COALESCE(ad.total_impressions, asd.total_impressions, 0) AS impressions,
    COALESCE(ad.total_clicks, asd.total_clicks, 0) AS clicks,
    
    -- === ORDER METRICS ===
    om.total_orders,
    
    -- === REVENUE (RON — already ÷100) ===
    om.real_revenue_ron,                        -- L2: Confirmed + Shipping (excl canceled)
    om.success_revenue_ron,                     -- L3: Delivered + COD collected
    
    -- === COSTS (RON) ===
    om.shipping_cost_ron,
    om.partner_fee_ron,
    
    -- === ROAS CALCULATIONS ===
    -- Convert RON → USD for ROAS (rate: 4.55 RON = 1 USD)
    ROUND(SAFE_DIVIDE(
        om.real_revenue_ron / 4.55,             -- Revenue in USD
        NULLIF(COALESCE(ad.total_spend_usd, asd.total_spend_usd, 0), 0)
    ), 2) AS real_roas,
    
    -- CPO (Cost per Order)
    ROUND(SAFE_DIVIDE(
        COALESCE(ad.total_spend_usd, asd.total_spend_usd, 0),
        NULLIF(om.total_orders, 0)
    ), 2) AS cost_per_order_usd,
    
    -- Net Profit Estimate (RON)
    ROUND(
        om.real_revenue_ron 
        - om.shipping_cost_ron 
        - om.partner_fee_ron
        - (COALESCE(ad.total_spend_usd, asd.total_spend_usd, 0) * 4.55)  -- Ads cost in RON
    , 2) AS estimated_net_profit_ron

FROM order_metrics om

-- JOIN 1: Campaign-level spend (for AD_MATCH and CAMPAIGN_TEXT_MATCH)
LEFT JOIN ads_daily ad 
    ON om.campaign_id = ad.campaign_id
    
-- JOIN 2: Adset-level spend (for ADSET_MATCH — STRAMARK's primary match type)
LEFT JOIN adset_daily asd 
    ON om.sample_adset_id = asd.adset_id
    AND om.campaign_id = asd.campaign_id

ORDER BY 
    ad_spend_usd DESC,
    total_orders DESC
;
