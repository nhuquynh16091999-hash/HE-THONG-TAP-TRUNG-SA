"""
Fix broken BigQuery views for STRAMARK and AUUS1 datasets.
Rebuilds views to match actual table schemas.
Run: python sql/fix_views.py
"""
import os, sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
os.environ['GOOGLE_APPLICATION_CREDENTIALS'] = os.path.join(PROJECT_DIR, 'bigquery_key.json')

from dotenv import load_dotenv
load_dotenv(os.path.join(PROJECT_DIR, '.env'))

from google.cloud import bigquery

P = 'levelup-465304'
client = bigquery.Client(project=P)


def run_sql(sql, label=""):
    """Execute SQL and report result."""
    try:
        job = client.query(sql)
        job.result()
        print(f"  ✅ {label}")
    except Exception as e:
        err = str(e)[:200]
        print(f"  ❌ {label}: {err}")


def fix_views(dataset):
    """Rebuild broken views for a dataset."""
    print(f"\n{'='*60}")
    print(f"  Fixing views for {dataset}")
    print(f"{'='*60}\n")

    # ──────────────────────────────────────────
    # 1. vw_sale_order_latest — dedup sale_order
    # ──────────────────────────────────────────
    run_sql(f"""
    CREATE OR REPLACE VIEW `{P}.{dataset}.vw_sale_order_latest` AS
    SELECT * EXCEPT(rn) FROM (
        SELECT *,
            ROW_NUMBER() OVER(PARTITION BY id ORDER BY sync_time DESC) AS rn
        FROM `{P}.{dataset}.sale_order`
    ) WHERE rn = 1
    """, "vw_sale_order_latest")

    # ──────────────────────────────────────────
    # 2. vw_order_items_latest — dedup order_items
    # ──────────────────────────────────────────
    run_sql(f"""
    CREATE OR REPLACE VIEW `{P}.{dataset}.vw_order_items_latest` AS
    SELECT * EXCEPT(rn) FROM (
        SELECT *,
            ROW_NUMBER() OVER(PARTITION BY item_id ORDER BY sync_time DESC) AS rn
        FROM `{P}.{dataset}.order_items`
    ) WHERE rn = 1
    """, "vw_order_items_latest")

    # ──────────────────────────────────────────
    # 3. vw_daily_pnl — daily P&L from actual columns
    #    sale_order has: total_price, cod, shipping_fee, partner_fee,
    #    return_fee, total_discount, status_name, inserted_at
    #    NO: project_id, prepaid, fee_marketplace
    # ──────────────────────────────────────────
    run_sql(f"""
    CREATE OR REPLACE VIEW `{P}.{dataset}.vw_daily_pnl` AS
    WITH daily_orders AS (
        SELECT
            DATE(PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%E*S', so.inserted_at)) AS order_date,
            CAST(so.shop_id AS STRING) AS shop_id,

            -- Revenue
            SUM(CAST(so.total_price AS FLOAT64)) AS gross_revenue,
            SUM(CASE WHEN so.status_name IN ('delivered','received_money','packing','packed','shipping')
                THEN CAST(so.total_price AS FLOAT64) ELSE 0 END) AS active_revenue,
            SUM(CASE WHEN so.status_name IN ('returned','returning')
                THEN CAST(so.total_price AS FLOAT64) ELSE 0 END) AS returned_revenue,
            SUM(CASE WHEN so.status_name IN ('delivered','received_money')
                THEN CAST(so.total_price AS FLOAT64) ELSE 0 END) AS collected_revenue,

            -- Costs
            SUM(CAST(so.shipping_fee AS FLOAT64)) AS total_shipping_fee,
            SUM(CAST(so.partner_fee AS FLOAT64)) AS total_partner_fee,
            SUM(CAST(so.return_fee AS FLOAT64)) AS total_return_fee,
            SUM(CAST(so.total_discount AS FLOAT64)) AS total_discount_amt,

            -- Counts
            COUNT(*) AS total_orders,
            COUNTIF(so.status_name IN ('delivered','received_money')) AS success_orders,
            COUNTIF(so.status_name IN ('returned','returning')) AS returned_orders,
            COUNTIF(so.status_name = 'canceled') AS canceled_orders,
            COUNTIF(so.status_name = 'new') AS new_orders,
            SUM(SAFE_CAST(so.total_quantity AS INT64)) AS total_items_sold

        FROM `{P}.{dataset}.vw_sale_order_latest` so
        GROUP BY 1, 2
    ),
    daily_cogs AS (
        SELECT
            DATE(PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%E*S', oi.order_inserted_at)) AS order_date,
            oi.shop_id,
            SUM(CAST(oi.quantity AS INT64) * CAST(oi.avg_imported_price AS FLOAT64)) AS total_cogs
        FROM `{P}.{dataset}.vw_order_items_latest` oi
        GROUP BY 1, 2
    )
    SELECT
        dor.*,
        COALESCE(dc.total_cogs, 0) AS cogs,
        dor.gross_revenue - COALESCE(dc.total_cogs, 0) AS gross_profit,
        dor.gross_revenue - COALESCE(dc.total_cogs, 0)
            - dor.total_shipping_fee - dor.total_partner_fee - dor.total_return_fee AS net_profit,
        SAFE_DIVIDE(
            dor.gross_revenue - COALESCE(dc.total_cogs, 0)
                - dor.total_shipping_fee - dor.total_partner_fee - dor.total_return_fee,
            NULLIF(dor.gross_revenue, 0)
        ) AS profit_margin
    FROM daily_orders dor
    LEFT JOIN daily_cogs dc ON dor.order_date = dc.order_date AND dor.shop_id = dc.shop_id
    """, "vw_daily_pnl")

    # ──────────────────────────────────────────
    # 4. vw_true_roas — True ROAS from ads + orders
    # ──────────────────────────────────────────
    run_sql(f"""
    CREATE OR REPLACE VIEW `{P}.{dataset}.vw_true_roas` AS
    WITH ads AS (
        SELECT * EXCEPT(rn) FROM (
            SELECT *,
                ROW_NUMBER() OVER(PARTITION BY ad_id, date, account_id ORDER BY spend DESC) AS rn
            FROM `{P}.{dataset}.fb_ads_data`
        ) WHERE rn = 1
    ),
    orders AS (
        SELECT
            CAST(ad_id AS STRING) AS ad_id,
            SUM(CAST(total_price AS FLOAT64)) AS total_revenue,
            COUNT(*) AS order_count
        FROM `{P}.{dataset}.vw_sale_order_latest`
        WHERE ad_id IS NOT NULL AND ad_id != '' AND ad_id != '0'
        GROUP BY 1
    )
    SELECT
        a.date AS ad_date,
        a.ad_id,
        a.ad_name,
        a.campaign_id,
        a.campaign_name,
        a.account_id,
        CAST(a.spend AS FLOAT64) AS ad_spend,
        CAST(a.impressions AS INT64) AS impressions,
        CAST(a.reach AS INT64) AS reach,
        COALESCE(o.total_revenue, 0) AS attributed_revenue,
        COALESCE(o.order_count, 0) AS success_orders,
        SAFE_DIVIDE(COALESCE(o.total_revenue, 0), NULLIF(CAST(a.spend AS FLOAT64), 0)) AS true_roas,
        SAFE_DIVIDE(CAST(a.spend AS FLOAT64), NULLIF(COALESCE(o.order_count, 0), 0)) AS cost_per_order
    FROM ads a
    LEFT JOIN orders o ON CAST(a.ad_id AS STRING) = o.ad_id
    """, "vw_true_roas")

    # ──────────────────────────────────────────
    # 5. vw_fact_ads_performance — ads performance
    #    fb_ads_data has: ad_id, ad_name, adset_id, adset_name,
    #    campaign_id, campaign_name, spend, impressions, reach, clicks,
    #    purchases, date, account_id, sync_time
    #    NO: link_clicks (missing in AUUS1)
    # ──────────────────────────────────────────
    run_sql(f"""
    CREATE OR REPLACE VIEW `{P}.{dataset}.vw_fact_ads_performance` AS
    WITH ads AS (
        SELECT
            a.ad_id, a.ad_name, a.adset_id, a.campaign_id, a.campaign_name,
            a.account_id,
            SAFE_CAST(a.date AS DATE) AS report_date,
            CAST(a.spend AS FLOAT64) AS spend,
            COALESCE(SAFE_CAST(a.impressions AS INT64), 0) AS impressions,
            COALESCE(SAFE_CAST(a.reach AS INT64), 0) AS reach,
            COALESCE(SAFE_CAST(a.clicks AS INT64), 0) AS clicks,
            COALESCE(SAFE_CAST(a.purchases AS INT64), 0) AS purchases
        FROM `{P}.{dataset}.fb_ads_data` a
    ),
    orders_by_adset AS (
        SELECT
            CAST(adset_id AS STRING) AS adset_id,
            COUNT(*) AS total_orders,
            COUNTIF(status_name IN ('delivered','received_money')) AS success_orders,
            SUM(CAST(total_price AS FLOAT64)) AS total_order_value
        FROM `{P}.{dataset}.vw_sale_order_latest`
        WHERE adset_id IS NOT NULL AND adset_id != ''
        GROUP BY 1
    )
    SELECT
        a.ad_id, a.ad_name, a.adset_id, a.campaign_id, a.campaign_name,
        a.account_id, a.report_date,
        a.spend,
        a.impressions, a.reach, a.clicks, a.purchases,

        -- Calculated metrics
        SAFE_DIVIDE(a.clicks, NULLIF(a.impressions, 0)) AS ctr,
        SAFE_DIVIDE(a.spend, NULLIF(a.clicks, 0)) AS cpc,
        SAFE_DIVIDE(a.spend, NULLIF(a.purchases, 0)) AS cost_per_purchase,

        -- Linked orders (via adset)
        COALESCE(o.total_orders, 0) AS linked_orders,
        COALESCE(o.success_orders, 0) AS linked_success_orders,
        COALESCE(o.total_order_value, 0) AS linked_order_value,

        -- ROAS
        SAFE_DIVIDE(COALESCE(o.total_order_value, 0), NULLIF(a.spend, 0)) AS roas
    FROM ads a
    LEFT JOIN orders_by_adset o ON CAST(a.adset_id AS STRING) = o.adset_id
    """, "vw_fact_ads_performance")

    print(f"\n  Done fixing {dataset} views.\n")


if __name__ == '__main__':
    fix_views('STRAMARK_Dataset')
    fix_views('AUUS1_Dataset')
    print("\n✅ All views rebuilt successfully.")
