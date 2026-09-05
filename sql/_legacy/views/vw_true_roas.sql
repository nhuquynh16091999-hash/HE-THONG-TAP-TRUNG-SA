-- vw_true_roas: True ROAS from POS orders matched to FB ads by ads_id
-- Multi-project: currently hardcoded zen8, will be dynamic when project_id added
-- Usage: SELECT * FROM FAOS_V2.vw_true_roas WHERE spend > 0

CREATE OR REPLACE VIEW `levelup-465304.FAOS_V2.vw_true_roas` AS

WITH orders_agg AS (
    SELECT
        fo.ads_id,
        DATE(fo.order_date) as order_date,
        'zen8' as project_id,
        fo.market,
        ANY_VALUE(fo.marketer) as marketer,
        SUM(fo.revenue) as order_revenue,
        SUM(CASE WHEN fo.status IN ('delivered','received_money') THEN fo.revenue ELSE 0 END) as collected_revenue,
        SUM(CASE WHEN fo.status IN ('returned','returning') THEN fo.revenue ELSE 0 END) as returned_revenue,
        COUNT(*) as total_orders,
        COUNTIF(fo.status IN ('delivered','received_money')) as delivered_orders,
        COUNTIF(fo.status IN ('returned','returning')) as returned_orders,
        SUM(fo.quantity) as total_quantity
    FROM `levelup-465304.FAOS_V2.fact_orders` fo
    WHERE fo.ads_id IS NOT NULL AND fo.ads_id != ''
    GROUP BY 1, 2, 3, 4
)

SELECT
    a.ad_id,
    a.ad_name,
    a.campaign_id,
    a.adset_id,
    a.date,
    COALESCE(o.project_id, 'zen8') as project_id,
    a.spend,
    a.impressions,
    a.reach,
    a.messages,
    COALESCE(o.order_revenue, 0) as order_revenue,
    COALESCE(o.collected_revenue, 0) as collected_revenue,
    COALESCE(o.returned_revenue, 0) as returned_revenue,
    COALESCE(o.total_orders, 0) as total_orders,
    COALESCE(o.delivered_orders, 0) as delivered_orders,
    COALESCE(o.returned_orders, 0) as returned_orders,
    COALESCE(o.market, '') as market,
    COALESCE(o.marketer, '') as marketer,
    SAFE_DIVIDE(COALESCE(o.order_revenue, 0), NULLIF(a.spend, 0)) as roas_order,
    SAFE_DIVIDE(COALESCE(o.collected_revenue, 0), NULLIF(a.spend, 0)) as roas_collected,
    SAFE_DIVIDE(COALESCE(o.returned_orders, 0), NULLIF(COALESCE(o.total_orders, 0), 0)) as return_rate,
    -- FFM cost (from config)
    COALESCE(o.total_orders, 0) * COALESCE(mf.ffm_fee_per_order, 0) as total_ffm_cost,
    COALESCE(o.total_orders, 0) * COALESCE(o.order_revenue, 0) * COALESCE(mf.cod_fee_pct, 0) as total_cod_cost
FROM `levelup-465304.FAOS_V2.fact_ads` a
LEFT JOIN orders_agg o
    ON a.ad_id = o.ads_id AND a.date = o.order_date
LEFT JOIN `levelup-465304.FAOS_V2.cost_ffm_fees` mf
    ON o.market = mf.market_code AND mf.valid_to IS NULL;
