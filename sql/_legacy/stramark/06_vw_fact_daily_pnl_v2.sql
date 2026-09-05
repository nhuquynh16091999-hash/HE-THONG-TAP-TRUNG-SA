-- ═══════════════════════════════════════════════════
-- vw_fact_daily_pnl_v2
-- Source of Truth: sql/stramark/06_vw_fact_daily_pnl_v2.sql
-- DO NOT modify via Python scripts
-- ═══════════════════════════════════════════════════

CREATE OR REPLACE VIEW `levelup-465304.STRAMARK_Dataset.vw_fact_daily_pnl_v2` AS
SELECT report_date,
    SUM(total_orders) AS total_orders,
    SUM(success_orders) AS success_orders,
    SUM(returned_orders) AS returned_orders,
    SUM(cancelled_orders) AS cancelled_orders,
    SUM(pending_orders) AS pending_orders,
    ROUND(SUM(revenue_lead), 0) AS revenue_lead,
    ROUND(SUM(revenue_success), 0) AS revenue_success,
    ROUND(SUM(delivered_revenue), 0) AS delivered_revenue,
    ROUND(SUM(revenue_cod_collected), 0) AS revenue_cod_collected,
    ROUND(SUM(partner_debt), 0) AS partner_debt,
    ROUND(SUM(ads_spend_usd), 2) AS ads_spend_usd,
    ROUND(SUM(ads_spend_ron), 0) AS ads_spend_ron,
    ROUND(SUM(shipping_cost), 0) AS shipping_cost,
    ROUND(SUM(fulfillment_cost), 0) AS fulfillment_cost,
    ROUND(SUM(return_fulfillment_cost), 0) AS return_fulfillment_cost,
    ROUND(SUM(cogs), 0) AS cogs,
    ROUND(SUM(net_profit), 0) AS net_profit,
    SUM(impressions) AS impressions,
    SUM(clicks) AS clicks,
    SUM(reach) AS reach,
    SUM(messages) AS messages,
    ROUND(SAFE_DIVIDE(SUM(revenue_success), NULLIF(SUM(ads_spend_ron), 0)), 2) AS roas_l3,
    ROUND(SAFE_DIVIDE(SUM(returned_orders), NULLIF(SUM(total_orders), 0)) * 100, 1) AS return_rate_pct,
    ROUND(SAFE_DIVIDE(SUM(success_orders), NULLIF(SUM(total_orders), 0)) * 100, 1) AS success_rate_pct,
    ROUND(SAFE_DIVIDE(SUM(ads_spend_ron), NULLIF(SUM(total_orders), 0)), 2) AS cpl_ron
FROM `levelup-465304.STRAMARK_Dataset.mart_performance_master`
GROUP BY 1
;
