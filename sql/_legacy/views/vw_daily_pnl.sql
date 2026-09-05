-- vw_daily_pnl: Daily P&L aggregation by project
-- Multi-project: currently hardcoded zen8
-- Usage: SELECT * FROM FAOS_V2.vw_daily_pnl WHERE date >= '2026-01-01'

CREATE OR REPLACE VIEW `levelup-465304.FAOS_V2.vw_daily_pnl` AS

WITH daily_revenue AS (
    SELECT
        DATE(fo.order_date) as date,
        'zen8' as project_id,
        fo.market,
        SUM(fo.revenue) as order_revenue,
        SUM(CASE WHEN fo.status IN ('delivered','received_money') THEN fo.revenue ELSE 0 END) as collected_revenue,
        SUM(CASE WHEN fo.status IN ('returned','returning') THEN fo.revenue ELSE 0 END) as returned_revenue,
        COUNT(*) as total_orders,
        COUNTIF(fo.status IN ('delivered','received_money')) as delivered_orders,
        COUNTIF(fo.status IN ('returned','returning')) as returned_orders
    FROM `levelup-465304.FAOS_V2.fact_orders` fo
    GROUP BY 1, 2, 3
),

daily_spend AS (
    SELECT
        a.date,
        'zen8' as project_id,
        SUM(a.spend) as ads_spend,
        SUM(a.impressions) as impressions,
        SUM(a.messages) as messages
    FROM `levelup-465304.FAOS_V2.fact_ads` a
    GROUP BY 1, 2
)

SELECT
    COALESCE(r.date, s.date) as date,
    COALESCE(r.project_id, s.project_id, 'zen8') as project_id,
    COALESCE(r.market, '') as market,
    COALESCE(r.order_revenue, 0) as order_revenue,
    COALESCE(r.collected_revenue, 0) as collected_revenue,
    COALESCE(r.returned_revenue, 0) as returned_revenue,
    COALESCE(s.ads_spend, 0) as ads_spend,
    COALESCE(r.total_orders, 0) as total_orders,
    COALESCE(r.delivered_orders, 0) as delivered_orders,
    COALESCE(r.returned_orders, 0) as returned_orders,
    COALESCE(s.messages, 0) as messages,
    -- FFM from config
    COALESCE(r.total_orders, 0) * COALESCE(mf.ffm_fee_per_order, 0) as ffm_cost,
    -- Gross profit (before COGS)
    COALESCE(r.collected_revenue, 0) - COALESCE(s.ads_spend, 0)
        - (COALESCE(r.total_orders, 0) * COALESCE(mf.ffm_fee_per_order, 0)) as gross_profit,
    SAFE_DIVIDE(COALESCE(r.order_revenue, 0), NULLIF(COALESCE(s.ads_spend, 0), 0)) as roas_order,
    SAFE_DIVIDE(COALESCE(r.collected_revenue, 0), NULLIF(COALESCE(s.ads_spend, 0), 0)) as roas_collected,
    SAFE_DIVIDE(COALESCE(r.returned_orders, 0), NULLIF(COALESCE(r.total_orders, 0), 0)) as return_rate
FROM daily_revenue r
FULL OUTER JOIN daily_spend s
    ON r.date = s.date AND r.project_id = s.project_id
LEFT JOIN `levelup-465304.FAOS_V2.cost_ffm_fees` mf
    ON r.market = mf.market_code AND mf.valid_to IS NULL;
