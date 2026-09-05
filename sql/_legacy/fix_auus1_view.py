"""Fix AUUS1 vw_fact_ads_performance — standalone script."""
import os
os.environ['GOOGLE_APPLICATION_CREDENTIALS'] = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'bigquery_key.json')
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env'))
from google.cloud import bigquery

P = 'levelup-465304'
DS = 'AUUS1_Dataset'
client = bigquery.Client(project=P)

sql = """
CREATE OR REPLACE VIEW `levelup-465304.AUUS1_Dataset.vw_fact_ads_performance` AS
WITH ads AS (
    SELECT a.ad_id, a.ad_name, a.adset_id, a.campaign_id, a.campaign_name,
        a.account_id, SAFE_CAST(a.date AS DATE) AS report_date,
        CAST(a.spend AS FLOAT64) AS spend,
        COALESCE(SAFE_CAST(a.impressions AS INT64), 0) AS impressions,
        COALESCE(SAFE_CAST(a.reach AS INT64), 0) AS reach,
        COALESCE(SAFE_CAST(a.clicks AS INT64), 0) AS clicks,
        COALESCE(SAFE_CAST(a.purchases AS INT64), 0) AS purchases
    FROM `levelup-465304.AUUS1_Dataset.fb_ads_data` a
),
orders_by_adset AS (
    SELECT CAST(adset_id AS STRING) AS adset_id,
        COUNT(*) AS total_orders,
        COUNTIF(status_name IN ('delivered','received_money')) AS success_orders,
        SUM(CAST(total_price AS FLOAT64)) AS total_order_value
    FROM `levelup-465304.AUUS1_Dataset.vw_sale_order_latest`
    WHERE adset_id IS NOT NULL AND adset_id != ''
    GROUP BY 1
)
SELECT a.ad_id, a.ad_name, a.adset_id, a.campaign_id, a.campaign_name,
    a.account_id, a.report_date, a.spend,
    a.impressions, a.reach, a.clicks, a.purchases,
    SAFE_DIVIDE(a.clicks, NULLIF(a.impressions, 0)) AS ctr,
    SAFE_DIVIDE(a.spend, NULLIF(a.clicks, 0)) AS cpc,
    SAFE_DIVIDE(a.spend, NULLIF(a.purchases, 0)) AS cost_per_purchase,
    COALESCE(o.total_orders, 0) AS linked_orders,
    COALESCE(o.success_orders, 0) AS linked_success_orders,
    COALESCE(o.total_order_value, 0) AS linked_order_value,
    SAFE_DIVIDE(COALESCE(o.total_order_value, 0), NULLIF(a.spend, 0)) AS roas
FROM ads a LEFT JOIN orders_by_adset o ON CAST(a.adset_id AS STRING) = o.adset_id
"""

job = client.query(sql)
job.result()
print("✅ AUUS1 vw_fact_ads_performance rebuilt successfully!")
