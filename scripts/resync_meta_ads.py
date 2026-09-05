#!/usr/bin/env python3
"""
═══════════════════════════════════════════════════════════════
FAOS v6 — Re-sync Meta Ads Data into BigQuery
═══════════════════════════════════════════════════════════════

Purpose:
  Re-pull ad-level insights from Meta Marketing API for a given
  date range and upsert into BigQuery `fb_ads_data` table.

  This is needed when campaign names are updated on Meta Ads Manager
  but BigQuery still has stale/old campaign names.

Usage:
  python scripts/resync_meta_ads.py --start 2026-01-01 --end 2026-01-31
  python scripts/resync_meta_ads.py --start 2026-01-01 --end 2026-01-31 --dry-run

Config:
  Reads credentials from config/projects/stramark.yaml
  Uses bigquery_key.json (or config/bigquery_key_stramark.json) for BQ auth.
"""

import argparse
import json
import logging
import os
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

import yaml
from google.cloud import bigquery
from google.oauth2 import service_account

# ─── Setup ───
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("resync_meta_ads")

# ─── Constants ───
GCP_PROJECT = "levelup-465304"
BQ_DATASET = "STRAMARK_Dataset"
BQ_TABLE = "fb_ads_data"

# Meta API fields to fetch at ad level
META_FIELDS = [
    "ad_id",
    "ad_name",
    "adset_id",
    "adset_name",
    "campaign_id",
    "campaign_name",
    "account_id",
    "account_name",
    "spend",
    "impressions",
    "reach",
    "clicks",
    "cpm",
    "cpc",
    "ctr",
    "actions",
    "action_values",
]


def _resolve_env_vars(obj):
    """Recursively resolve ${VAR} references in parsed YAML values."""
    if isinstance(obj, str):
        import re
        m = re.match(r'^\$\{(.+)\}$', obj)
        if m:
            return os.environ.get(m.group(1), obj)
        return obj
    if isinstance(obj, list):
        return [_resolve_env_vars(v) for v in obj]
    if isinstance(obj, dict):
        return {k: _resolve_env_vars(v) for k, v in obj.items()}
    return obj


def load_config():
    """Load Stramark project config from YAML, resolving ${ENV_VAR} refs."""
    # Load .env so ${META_ACCESS_TOKEN} etc. are available
    from dotenv import load_dotenv
    load_dotenv(PROJECT_ROOT / ".env")

    config_path = PROJECT_ROOT / "config" / "projects" / "stramark.yaml"
    if not config_path.exists():
        log.error(f"Config not found: {config_path}")
        sys.exit(1)

    with open(config_path, "r", encoding="utf-8") as f:
        config = yaml.safe_load(f)

    config = _resolve_env_vars(config)
    log.info(f"Loaded config for project: {config.get('project_name', 'UNKNOWN')}")
    return config


def get_bq_client():
    """Create BigQuery client with service account credentials."""
    # Try multiple credential file paths
    cred_paths = [
        PROJECT_ROOT / "config" / "bigquery_key_stramark.json",
        PROJECT_ROOT / "bigquery_key.json",
    ]

    for cred_path in cred_paths:
        if cred_path.exists():
            credentials = service_account.Credentials.from_service_account_file(
                str(cred_path)
            )
            client = bigquery.Client(
                project=GCP_PROJECT, credentials=credentials
            )
            log.info(f"BigQuery client created (creds: {cred_path.name})")
            return client

    log.error("No BigQuery credentials found!")
    sys.exit(1)


def fetch_meta_ads_insights(config, start_date, end_date):
    """
    Fetch ad-level insights from Meta Marketing API for the given date range.
    Uses direct HTTP requests with appsecret_proof.

    Returns a list of dicts matching the fb_ads_data schema.
    """
    import requests

    meta_config = config["meta_ads"]
    access_token = meta_config["access_token"]
    ad_account_ids = meta_config["ad_account_ids"]

    API_VERSION = "v21.0"
    BASE_URL = f"https://graph.facebook.com/{API_VERSION}"

    fields_str = ",".join(META_FIELDS)
    log.info("Meta API configured (direct HTTP, no SDK)")

    all_rows = []

    for account_id in ad_account_ids:
        log.info(f"═══ Fetching ads for account: {account_id} ═══")

        url = f"{BASE_URL}/{account_id}/insights"
        params = {
            "access_token": access_token,
            "fields": fields_str,
            "time_range": json.dumps({"since": start_date, "until": end_date}),
            "time_increment": 1,
            "level": "ad",
            "limit": 500,
        }

        account_rows = []
        page_num = 0

        while url:
            page_num += 1
            try:
                resp = requests.get(url, params=params if page_num == 1 else None, timeout=120)
                resp.raise_for_status()
                data = resp.json()
            except requests.RequestException as e:
                log.error(f"  ✗ HTTP error fetching {account_id} (page {page_num}): {e}")
                if hasattr(e, 'response') and e.response is not None:
                    log.error(f"    Response: {e.response.text[:500]}")
                raise

            if "error" in data:
                error_msg = data["error"].get("message", "Unknown error")
                log.error(f"  ✗ Meta API error: {error_msg}")
                raise RuntimeError(f"Meta API error: {error_msg}")

            # Parse each insight record
            for record in data.get("data", []):
                row = _parse_insight_dict(record)
                if row:
                    account_rows.append(row)

            # Handle pagination
            paging = data.get("paging", {})
            url = paging.get("next")  # Full URL with cursor
            # Don't send params again for paginated requests (next URL has them)

            if page_num % 5 == 0:
                log.info(f"  ... page {page_num}: {len(account_rows)} rows so far")

        log.info(f"  → Fetched {len(account_rows)} rows from {account_id} ({page_num} pages)")
        all_rows.extend(account_rows)

    log.info(f"Total rows fetched from Meta API: {len(all_rows)}")
    return all_rows


def _parse_insight_dict(data):
    """Parse a single Meta API insight dict into STRAMARK fb_ads_data schema.
    
    STRAMARK schema: ad_id, ad_name, adset_id, adset_name, campaign_id,
    campaign_name, spend, impressions, reach, clicks, purchases, date,
    account_id, sync_time
    """
    # Extract purchases count from actions
    purchases = 0
    if "actions" in data and data["actions"]:
        for action in data["actions"]:
            if action.get("action_type") == "purchase":
                purchases = int(action.get("value", 0))

    row = {
        "ad_id": str(data.get("ad_id", "")),
        "ad_name": str(data.get("ad_name", "")),
        "adset_id": str(data.get("adset_id", "")),
        "adset_name": str(data.get("adset_name", "")),
        "campaign_id": str(data.get("campaign_id", "")),
        "campaign_name": str(data.get("campaign_name", "")),
        "spend": float(data.get("spend", 0)),
        "impressions": int(data.get("impressions", 0)),
        "reach": int(data.get("reach", 0)),
        "clicks": int(data.get("clicks", 0)),
        "purchases": purchases,
        "date": str(data.get("date_start", "")),
        "account_id": str(data.get("account_id", "")),
        "sync_time": datetime.utcnow().isoformat(),
    }

    return row


def delete_existing_data(bq_client, start_date, end_date):
    """Delete existing fb_ads_data rows for the given date range."""
    table_ref = f"`{GCP_PROJECT}.{BQ_DATASET}.{BQ_TABLE}`"

    query = f"""
    DELETE FROM {table_ref}
    WHERE CAST(date AS DATE) BETWEEN '{start_date}' AND '{end_date}'
    """

    log.info(f"Deleting existing data from {start_date} to {end_date}...")
    job = bq_client.query(query)
    result = job.result()  # Wait for completion
    log.info(f"  → Deleted {job.num_dml_affected_rows} rows")
    return job.num_dml_affected_rows


def insert_data(bq_client, rows):
    """Insert rows into fb_ads_data table."""
    table_id = f"{GCP_PROJECT}.{BQ_DATASET}.{BQ_TABLE}"

    if not rows:
        log.warning("No rows to insert!")
        return 0

    # Insert in batches of 500
    batch_size = 500
    total_inserted = 0

    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]
        errors = bq_client.insert_rows_json(table_id, batch)
        if errors:
            log.error(f"  ✗ Batch {i // batch_size + 1} errors: {errors[:3]}")
            raise RuntimeError(f"BigQuery insert errors: {errors}")
        total_inserted += len(batch)
        log.info(f"  → Inserted batch {i // batch_size + 1}: {len(batch)} rows (total: {total_inserted})")

    log.info(f"Total inserted: {total_inserted} rows")
    return total_inserted


def verify_data(bq_client, start_date, end_date):
    """Verify the data was inserted correctly by checking marketer attribution."""
    query = f"""
    SELECT 
        COALESCE(
            CASE
                WHEN ENDS_WITH(campaign_name, ' Lệ') OR ENDS_WITH(campaign_name, '-Lệ')
                    OR ENDS_WITH(campaign_name, '_Lệ') THEN 'LETC'
                WHEN ENDS_WITH(campaign_name, ' LC') OR ENDS_WITH(campaign_name, '-LC')
                    OR ENDS_WITH(campaign_name, '_LC') THEN 'CHIPTL'
                WHEN ENDS_WITH(campaign_name, ' TA') OR ENDS_WITH(campaign_name, '-TA')
                    OR ENDS_WITH(campaign_name, '_TA') THEN 'ANHNT'
                WHEN ENDS_WITH(campaign_name, ' TÚ') OR ENDS_WITH(campaign_name, ' Tú')
                    OR ENDS_WITH(campaign_name, '-TÚ') OR ENDS_WITH(campaign_name, '-Tú')
                    OR ENDS_WITH(campaign_name, ' Kim Tu') OR ENDS_WITH(campaign_name, ' Kim Tú') THEN 'TUKT'
                ELSE 'UNMATCHED'
            END
        ) AS marketer_id,
        COUNT(*) AS row_count,
        ROUND(SUM(spend), 2) AS total_spend_usd,
        COUNT(DISTINCT campaign_name) AS unique_campaigns
    FROM `{GCP_PROJECT}.{BQ_DATASET}.{BQ_TABLE}`
    WHERE CAST(date AS DATE) BETWEEN '{start_date}' AND '{end_date}'
    GROUP BY 1
    ORDER BY 1
    """

    log.info("═══ Verification: marketer attribution check ═══")
    results = bq_client.query(query).result()
    for row in results:
        icon = "✅" if row.marketer_id != "UNMATCHED" else "⚠️"
        log.info(
            f"  {icon} {row.marketer_id}: {row.row_count} rows, "
            f"${row.total_spend_usd} spend, {row.unique_campaigns} campaigns"
        )


def main():
    parser = argparse.ArgumentParser(
        description="Re-sync Meta Ads data into BigQuery fb_ads_data"
    )
    parser.add_argument(
        "--start",
        required=True,
        help="Start date (YYYY-MM-DD), e.g. 2026-01-01",
    )
    parser.add_argument(
        "--end",
        required=True,
        help="End date (YYYY-MM-DD), e.g. 2026-01-31",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch data from Meta but do NOT write to BigQuery",
    )
    args = parser.parse_args()

    # Validate dates
    try:
        start_dt = datetime.strptime(args.start, "%Y-%m-%d")
        end_dt = datetime.strptime(args.end, "%Y-%m-%d")
        if start_dt > end_dt:
            log.error("Start date must be before end date")
            sys.exit(1)
    except ValueError:
        log.error("Invalid date format. Use YYYY-MM-DD")
        sys.exit(1)

    log.info("═══════════════════════════════════════════════════")
    log.info("  FAOS v6 — Meta Ads Data Re-sync")
    log.info(f"  Date range: {args.start} → {args.end}")
    log.info(f"  Target: {GCP_PROJECT}.{BQ_DATASET}.{BQ_TABLE}")
    log.info(f"  Mode: {'DRY RUN' if args.dry_run else 'LIVE'}")
    log.info("═══════════════════════════════════════════════════")

    # Step 1: Load config
    config = load_config()

    # Step 2: Fetch data from Meta API
    log.info("\n📥 Step 1/3: Fetching data from Meta API...")
    rows = fetch_meta_ads_insights(config, args.start, args.end)

    if not rows:
        log.error("No data returned from Meta API! Aborting.")
        sys.exit(1)

    # Show sample campaign names
    campaign_names = set(r["campaign_name"] for r in rows)
    log.info(f"\n📋 Unique campaign names found ({len(campaign_names)}):")
    for name in sorted(campaign_names)[:20]:
        log.info(f"   • {name}")
    if len(campaign_names) > 20:
        log.info(f"   ... and {len(campaign_names) - 20} more")

    if args.dry_run:
        log.info("\n🔒 DRY RUN — skipping BigQuery operations")
        log.info(f"   Would delete existing data for {args.start} → {args.end}")
        log.info(f"   Would insert {len(rows)} rows")
        return

    # Step 3: Delete existing data + Insert fresh data
    bq_client = get_bq_client()

    log.info("\n🗑️  Step 2/3: Deleting existing data...")
    deleted = delete_existing_data(bq_client, args.start, args.end)

    log.info("\n📤 Step 3/3: Inserting fresh data...")
    inserted = insert_data(bq_client, rows)

    # Step 4: Verify
    log.info("")
    verify_data(bq_client, args.start, args.end)

    log.info("\n═══════════════════════════════════════════════════")
    log.info("  ✅ Re-sync complete!")
    log.info(f"  Deleted: {deleted} old rows")
    log.info(f"  Inserted: {inserted} fresh rows")
    log.info("═══════════════════════════════════════════════════")


if __name__ == "__main__":
    main()
