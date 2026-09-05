#!/usr/bin/env python3
"""
init_project_dataset.py — Auto-setup a new BQ dataset for FAOS project.

Steps:
  1. Create BQ dataset (if not exists)
  2. Create core tables (standardized schema)
  3. Seed dim_country_payment from project config
  4. Create adapter view (vw_fb_ads_standard)
  5. Create flexible P&L view (vw_fact_daily_pnl_flex)
  6. Verify all views query OK

Usage:
  python scripts/init_project_dataset.py --config config/projects/newproject.yaml --dry-run
  python scripts/init_project_dataset.py --config config/projects/newproject.yaml
"""
import argparse
import os
import sys
import yaml

def main():
    parser = argparse.ArgumentParser(description="Initialize FAOS BQ dataset")
    parser.add_argument("--config", required=True, help="Path to project YAML")
    parser.add_argument("--dry-run", action="store_true", help="Print SQL without executing")
    parser.add_argument("--credentials", default="bigquery_key.json", help="BQ credentials file")
    args = parser.parse_args()

    # Load config
    with open(args.config) as f:
        cfg = yaml.safe_load(f)

    project_id = cfg.get("bigquery", {}).get("project", "levelup-465304")
    dataset = cfg.get("bigquery", {}).get("dataset")
    markets = cfg.get("markets", [])

    if not dataset:
        print("ERROR: bigquery.dataset not found in config")
        sys.exit(1)

    print(f"Project: {project_id}")
    print(f"Dataset: {dataset}")
    print(f"Markets: {len(markets)}")
    print(f"Dry run: {args.dry_run}")
    print()

    if not args.dry_run:
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = args.credentials
        from google.cloud import bigquery
        client = bigquery.Client(project_id)
    else:
        client = None

    # Step 1: Create dataset
    print("Step 1: Create dataset...")
    if not args.dry_run:
        ds_ref = bigquery.Dataset(f"{project_id}.{dataset}")
        ds_ref.location = "US"
        try:
            client.create_dataset(ds_ref, exists_ok=True)
            print(f"  OK: {dataset} created/exists")
        except Exception as e:
            print(f"  FAIL: {e}")
    else:
        print(f"  [DRY RUN] CREATE DATASET {dataset}")

    # Step 2: Create core tables
    print("\nStep 2: Create core tables...")
    tables = {
        "sale_order": "id STRING, status STRING, cod STRING, total_price STRING, "
                      "inserted_at STRING, shipping_province STRING, sync_time STRING",
        "order_items": "id STRING, order_id STRING, product_id STRING, quantity STRING, "
                       "price STRING, sync_time STRING",
        "fb_ads_data": "ad_id STRING, ad_name STRING, adset_id STRING, adset_name STRING, "
                       "campaign_id STRING, campaign_name STRING, account_id STRING, "
                       "date STRING, spend FLOAT64, impressions INT64, reach INT64, "
                       "clicks INT64, cpm FLOAT64, cpc FLOAT64, ctr FLOAT64, "
                       "frequency FLOAT64, purchases INT64, purchase_value FLOAT64, "
                       "leads FLOAT64, messaging_conversations_started INT64, "
                       "add_to_cart INT64, sync_time STRING",
        "customers": "id STRING, name STRING, phone STRING, email STRING, sync_time STRING",
        "product_template": "id STRING, name STRING, list_price STRING, sync_time STRING",
        "product_variations": "id STRING, product_id STRING, name STRING, sync_time STRING",
        "dim_country_payment": "country_code STRING NOT NULL, country_name STRING NOT NULL, "
                               "payment_model STRING NOT NULL, region STRING NOT NULL, "
                               "currency STRING NOT NULL, requires_dual_roas BOOL NOT NULL",
    }

    for tbl, schema in tables.items():
        sql = f"CREATE TABLE IF NOT EXISTS `{project_id}.{dataset}.{tbl}` ({schema})"
        if not args.dry_run:
            try:
                client.query(sql).result()
                print(f"  OK: {tbl}")
            except Exception as e:
                print(f"  FAIL {tbl}: {str(e)[:150]}")
        else:
            print(f"  [DRY RUN] CREATE TABLE {tbl}")

    # Step 3: Seed dim_country_payment
    print("\nStep 3: Seed dim_country_payment...")
    if markets and not args.dry_run:
        try:
            client.query(f"DELETE FROM `{project_id}.{dataset}.dim_country_payment` WHERE TRUE").result()
            rows = [
                {"country_code": m["code"], "country_name": m.get("name", m["code"]),
                 "payment_model": m["payment"], "region": m.get("region", "OTHER"),
                 "currency": m["currency"],
                 "requires_dual_roas": m["payment"] == "COD"}
                for m in markets
            ]
            errors = client.insert_rows_json(f"{project_id}.{dataset}.dim_country_payment", rows)
            if errors:
                print(f"  FAIL: {errors[:2]}")
            else:
                print(f"  OK: {len(rows)} countries seeded")
        except Exception as e:
            print(f"  FAIL: {str(e)[:150]}")
    elif markets:
        print(f"  [DRY RUN] INSERT {len(markets)} countries")
    else:
        print("  SKIP: No markets in config")

    # Step 4: Create adapter view
    print("\nStep 4: Create vw_fb_ads_standard...")
    adapter_sql = f"""
    CREATE OR REPLACE VIEW `{project_id}.{dataset}.vw_fb_ads_standard` AS
    SELECT ad_id, ad_name, adset_id, adset_name, campaign_id, campaign_name, account_id,
      CAST(date AS DATE) AS date,
      COALESCE(CAST(spend AS FLOAT64),0) AS spend,
      COALESCE(CAST(impressions AS INT64),0) AS impressions,
      COALESCE(CAST(reach AS INT64),0) AS reach,
      COALESCE(CAST(clicks AS INT64),0) AS clicks,
      COALESCE(CAST(cpm AS FLOAT64),0) AS cpm,
      COALESCE(CAST(cpc AS FLOAT64),0) AS cpc,
      COALESCE(CAST(ctr AS FLOAT64),0) AS ctr,
      COALESCE(CAST(frequency AS FLOAT64),0) AS frequency,
      COALESCE(CAST(purchases AS INT64),0) AS purchases,
      COALESCE(CAST(purchase_value AS FLOAT64),0) AS purchase_value,
      COALESCE(CAST(leads AS FLOAT64),0) AS leads,
      COALESCE(CAST(messaging_conversations_started AS INT64),0) AS messaging_conversations_started,
      COALESCE(CAST(add_to_cart AS INT64),0) AS add_to_cart,
      sync_time
    FROM `{project_id}.{dataset}.fb_ads_data`
    """
    if not args.dry_run:
        try:
            client.query(adapter_sql).result()
            print("  OK: vw_fb_ads_standard created")
        except Exception as e:
            print(f"  FAIL: {str(e)[:150]}")
    else:
        print("  [DRY RUN] CREATE VIEW vw_fb_ads_standard")

    # Step 5: Create flexible P&L view
    print("\nStep 5: Create vw_fact_daily_pnl_flex...")
    pnl_path = os.path.join(os.path.dirname(__file__), "..", "sql/v6/views/vw_fact_daily_pnl_flex.sql")
    if os.path.exists(pnl_path):
        with open(pnl_path) as f:
            pnl_sql = f.read().replace("{DATASET}", dataset)
        if not args.dry_run:
            try:
                client.query(pnl_sql).result()
                print("  OK: vw_fact_daily_pnl_flex created")
            except Exception as e:
                print(f"  FAIL: {str(e)[:150]}")
        else:
            print("  [DRY RUN] CREATE VIEW vw_fact_daily_pnl_flex")
    else:
        print(f"  SKIP: {pnl_path} not found")

    # Step 6: Verify
    print("\nStep 6: Verify...")
    if not args.dry_run:
        for view in ["vw_fb_ads_standard", "vw_fact_daily_pnl_flex"]:
            try:
                rows = list(client.query(
                    f"SELECT COUNT(*) c FROM `{project_id}.{dataset}.{view}`"
                ).result())
                print(f"  OK: {view} — {rows[0].c} rows")
            except Exception as e:
                print(f"  FAIL {view}: {str(e)[:150]}")
    else:
        print("  [DRY RUN] VERIFY views")

    print("\nDONE!")

if __name__ == "__main__":
    main()
