#!/usr/bin/env python3
"""Deploy vw_fb_ads_standard adapter views to all 4 BQ datasets."""
from google.cloud import bigquery
import os

os.environ.setdefault("GOOGLE_APPLICATION_CREDENTIALS", "/opt/faos/bigquery_key.json")
client = bigquery.Client("levelup-465304")

# Per-dataset column mappings for fb_ads_data differences
DATASET_CONFIGS = {
    "STRAMARK_Dataset": {
        "date_col": "CAST(date AS DATE)",
        "purchases_col": "COALESCE(CAST(purchases AS INT64),0)",
        "purchase_value_col": "0.0",
    },
    "AUUS1_Dataset": {
        "date_col": "CAST(date AS DATE)",
        "purchases_col": "COALESCE(CAST(purchases AS INT64),0)",
        "purchase_value_col": "COALESCE(CAST(purchase_value AS FLOAT64),0)",
    },
    "TALPHA_Dataset": {
        "date_col": "CAST(date_start AS DATE)",
        "purchases_col": "COALESCE(CAST(actions_purchase AS INT64),0)",
        "purchase_value_col": "COALESCE(CAST(action_values_purchase AS FLOAT64),0)",
    },
    "T1_Dataset": {
        "date_col": "CAST(date AS DATE)",
        "purchases_col": "COALESCE(CAST(purchases AS INT64),0)",
        "purchase_value_col": "COALESCE(CAST(purchase_value AS FLOAT64),0)",
    },
}

TEMPLATE = """
CREATE OR REPLACE VIEW `levelup-465304.{ds}.vw_fb_ads_standard` AS
SELECT
    ad_id, ad_name, adset_id, adset_name,
    campaign_id, campaign_name, account_id,
    {date_col}                                              AS date,
    COALESCE(CAST(spend AS FLOAT64),0)                      AS spend,
    COALESCE(CAST(impressions AS INT64),0)                   AS impressions,
    COALESCE(CAST(reach AS INT64),0)                         AS reach,
    COALESCE(CAST(clicks AS INT64),0)                        AS clicks,
    COALESCE(CAST(cpm AS FLOAT64),0)                         AS cpm,
    COALESCE(CAST(cpc AS FLOAT64),0)                         AS cpc,
    COALESCE(CAST(ctr AS FLOAT64),0)                         AS ctr,
    COALESCE(CAST(frequency AS FLOAT64),0)                   AS frequency,
    {purchases_col}                                          AS purchases,
    {purchase_value_col}                                     AS purchase_value,
    COALESCE(CAST(leads AS FLOAT64),0)                       AS leads,
    COALESCE(CAST(messaging_conversations_started AS INT64),0)
                                                             AS messaging_conversations_started,
    COALESCE(CAST(add_to_cart AS INT64),0)                    AS add_to_cart,
    sync_time
FROM `levelup-465304.{ds}.fb_ads_data`
"""

for ds, cfg in DATASET_CONFIGS.items():
    sql = TEMPLATE.format(ds=ds, **cfg)
    try:
        client.query(sql).result()
        rows = list(client.query(
            f"SELECT COUNT(*) c FROM `levelup-465304.{ds}.vw_fb_ads_standard`"
        ).result())
        print(f"OK: {ds} — {rows[0].c} rows")
    except Exception as e:
        print(f"FAIL {ds}: {str(e)[:200]}")

print("DONE")
