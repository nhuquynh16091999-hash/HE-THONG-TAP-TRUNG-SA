"""Fix broken dashboard views — PARSE_DATE %H format error.
The views use PARSE_DATE('%Y-%m-%dT%H:%M:%S', ...) which fails
because PARSE_DATE only accepts date formats (no %H/%M/%S).
Fix: use SAFE_CAST(SUBSTR(inserted_at, 1, 10) AS DATE).
"""
import os
os.environ['GOOGLE_APPLICATION_CREDENTIALS'] = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'bigquery_key.json')
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env'))
from google.cloud import bigquery

P = 'levelup-465304'
client = bigquery.Client(project=P)

def run_sql(sql, label=""):
    try:
        job = client.query(sql)
        job.result()
        print(f"  ✅ {label}")
    except Exception as e:
        print(f"  ❌ {label}: {str(e)[:200]}")

def fix_dashboard_views(ds):
    print(f"\nFixing dashboard views for {ds}...")

    # 1. vw_dashboard_overview
    run_sql(f"""
    CREATE OR REPLACE VIEW `{P}.{ds}.vw_dashboard_overview` AS
    SELECT
      SAFE_CAST(SUBSTR(o.inserted_at, 1, 10) AS DATE) AS order_date,
      'Default' AS shop_group,
      '{ds.replace("_Dataset","")}' AS project,
      COUNT(DISTINCT o.id) AS total_orders,
      COUNT(DISTINCT CASE WHEN CAST(o.status AS INT64) IN (3,4) THEN o.id END) AS success_orders,
      COUNT(DISTINCT CASE WHEN CAST(o.status AS INT64) = -1 THEN o.id END) AS returned_orders,
      COUNT(DISTINCT CASE WHEN CAST(o.status AS INT64) = -2 THEN o.id END) AS cancelled_orders,
      ROUND(SUM(CASE WHEN CAST(o.status AS INT64) IN (3,4) THEN CAST(o.total_price AS FLOAT64) ELSE 0 END)) AS gross_revenue,
      ROUND(SUM(CASE WHEN CAST(o.status AS INT64) = -1 THEN CAST(o.total_price AS FLOAT64) ELSE 0 END)) AS returned_revenue,
      ROUND(SUM(CASE WHEN CAST(o.status AS INT64) IN (3,4) THEN CAST(o.total_discount AS FLOAT64) ELSE 0 END)) AS total_discounts,
      ROUND(SUM(CASE WHEN CAST(o.status AS INT64) IN (3,4) THEN CAST(o.shipping_fee AS FLOAT64) ELSE 0 END)) AS shipping_fees,
      COUNT(DISTINCT o.customer_id) AS unique_customers,
      ROUND(SUM(CASE WHEN CAST(o.status AS INT64) IN (3,4) THEN CAST(o.total_quantity AS FLOAT64) ELSE 0 END)) AS items_sold
    FROM `{P}.{ds}.vw_sale_order_latest` o
    WHERE o.inserted_at IS NOT NULL AND o.inserted_at != ''
    GROUP BY 1, 2, 3
    """, "vw_dashboard_overview")

    # 2. vw_dashboard_marketing
    run_sql(f"""
    CREATE OR REPLACE VIEW `{P}.{ds}.vw_dashboard_marketing` AS
    SELECT
      SAFE_CAST(SUBSTR(o.inserted_at, 1, 10) AS DATE) AS order_date,
      'Default' AS shop_group,
      COALESCE(NULLIF(o.p_utm_source, ''), NULLIF(o.ads_source, ''), 'direct') AS source,
      COALESCE(NULLIF(o.p_utm_medium, ''), 'none') AS medium,
      COALESCE(NULLIF(o.p_utm_campaign, ''), 'none') AS campaign,
      o.marketer,
      COUNT(DISTINCT o.id) AS orders,
      ROUND(SUM(CASE WHEN CAST(o.status AS INT64) IN (3,4) THEN CAST(o.total_price AS FLOAT64) ELSE 0 END)) AS revenue,
      COUNT(DISTINCT o.customer_id) AS customers
    FROM `{P}.{ds}.vw_sale_order_latest` o
    WHERE o.inserted_at IS NOT NULL AND o.inserted_at != ''
    GROUP BY 1, 2, 3, 4, 5, 6
    """, "vw_dashboard_marketing")

    # 3. vw_dashboard_funnel
    run_sql(f"""
    CREATE OR REPLACE VIEW `{P}.{ds}.vw_dashboard_funnel` AS
    SELECT
      SAFE_CAST(SUBSTR(o.inserted_at, 1, 10) AS DATE) AS order_date,
      'Default' AS shop_group,
      o.status_name,
      CAST(o.status AS INT64) AS status_code,
      COUNT(*) AS order_count,
      ROUND(SUM(CAST(o.total_price AS FLOAT64))) AS total_value
    FROM `{P}.{ds}.vw_sale_order_latest` o
    WHERE o.inserted_at IS NOT NULL AND o.inserted_at != ''
    GROUP BY 1, 2, 3, 4
    """, "vw_dashboard_funnel")

    # 4. vw_dashboard_products
    run_sql(f"""
    CREATE OR REPLACE VIEW `{P}.{ds}.vw_dashboard_products` AS
    SELECT
      SAFE_CAST(SUBSTR(i.order_inserted_at, 1, 10) AS DATE) AS order_date,
      i.shop_id AS shop_name,
      i.product_name,
      i.variation_name,
      COALESCE(i.barcode, '') AS barcode,
      SUM(CAST(i.quantity AS INT64)) AS qty_sold,
      SUM(CAST(i.return_quantity AS INT64)) AS qty_returned,
      ROUND(SUM(CAST(i.quantity AS INT64) * CAST(i.retail_price AS FLOAT64))) AS revenue,
      ROUND(SUM(CAST(i.quantity AS INT64) * CAST(i.avg_imported_price AS FLOAT64))) AS cogs,
      ROUND(SUM(CAST(i.quantity AS INT64) * (CAST(i.retail_price AS FLOAT64) - CAST(i.avg_imported_price AS FLOAT64)))) AS gross_profit,
      SAFE_DIVIDE(
        SUM(CAST(i.return_quantity AS INT64)),
        SUM(CAST(i.quantity AS INT64))
      ) AS return_rate
    FROM `{P}.{ds}.vw_order_items_latest` i
    WHERE i.order_inserted_at IS NOT NULL AND i.order_inserted_at != ''
    GROUP BY 1, 2, 3, 4, 5
    """, "vw_dashboard_products")


if __name__ == '__main__':
    fix_dashboard_views('STRAMARK_Dataset')
    fix_dashboard_views('AUUS1_Dataset')
    print("\n✅ All dashboard views fixed.")
