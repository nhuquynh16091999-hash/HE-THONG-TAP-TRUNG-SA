#!/usr/bin/env python3
"""
Sync Meta Ads data to BigQuery (fb_ads_data table).
Pulls ad-level insights from Meta API for AUUS1 ad accounts
and inserts into BigQuery.

Usage:
    python scripts/sync_meta_to_bq.py                    # sync last 7 days
    python scripts/sync_meta_to_bq.py --days 30          # sync last 30 days
    python scripts/sync_meta_to_bq.py --since 2026-03-01 # sync from specific date
"""

import os, sys, json, hashlib, argparse
from datetime import datetime, timedelta
from pathlib import Path

import requests
from google.cloud import bigquery
from dotenv import load_dotenv

# ─── Load env ───
env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(env_path)

# ─── Config ───
ACCESS_TOKEN = os.getenv("META_ACCESS_TOKEN")
APP_SECRET = os.getenv("META_APP_SECRET")
BQ_PROJECT = "levelup-465304"
BQ_DATASET = "AUUS1_Dataset"
BQ_TABLE = "fb_ads_data"
GCP_CREDS = os.getenv("GOOGLE_APPLICATION_CREDENTIALS",
                       str(Path(__file__).resolve().parent.parent / "bigquery_key.json"))

# AUUS1 ad accounts — read from .env
_raw_accounts = os.getenv("META_AD_ACCOUNT_IDS", "")
AD_ACCOUNTS = [a.strip() for a in _raw_accounts.split(",") if a.strip()]
if not AD_ACCOUNTS:
    # fallback
    AD_ACCOUNTS = [
        "act_2002604803685498",
        "act_2026217937936451",
    ]

META_API_VERSION = "v21.0"
META_BASE = f"https://graph.facebook.com/{META_API_VERSION}"

# Fields to fetch from Meta API
INSIGHT_FIELDS = [
    "ad_id", "ad_name", "adset_id", "adset_name",
    "campaign_id", "campaign_name", "account_id",
    "spend", "impressions", "reach", "clicks",
    "cpc", "cpm", "ctr", "frequency",
    "actions",
]


def generate_appsecret_proof(token: str, secret: str) -> str:
    import hmac
    return hmac.new(secret.encode(), token.encode(), hashlib.sha256).hexdigest()


def fetch_insights(account_id: str, since: str, until: str) -> list[dict]:
    """Fetch ad-level insights from Meta API for a date range."""
    url = f"{META_BASE}/{account_id}/insights"
    params = {
        "access_token": ACCESS_TOKEN,
        "fields": ",".join(INSIGHT_FIELDS),
        "level": "ad",
        "time_range": json.dumps({"since": since, "until": until}),
        "time_increment": 1,  # daily breakdown
        "limit": 500,
        "filtering": json.dumps([{
            "field": "spend",
            "operator": "GREATER_THAN",
            "value": "0"
        }]),
    }

    if APP_SECRET:
        params["appsecret_proof"] = generate_appsecret_proof(ACCESS_TOKEN, APP_SECRET)

    all_rows = []
    page = 1

    while url:
        print(f"  📡 Fetching page {page} for {account_id}...")
        resp = requests.get(url, params=params if page == 1 else None)
        data = resp.json()

        if "error" in data:
            print(f"  ❌ Meta API error: {data['error'].get('message', data['error'])}")
            break

        rows = data.get("data", [])
        all_rows.extend(rows)
        print(f"  ✅ Got {len(rows)} records (total: {len(all_rows)})")

        # Pagination
        paging = data.get("paging", {})
        url = paging.get("next")
        params = None  # next URL has params embedded
        page += 1

    return all_rows


def extract_action_value(actions: list, action_type: str) -> int:
    """Extract a specific action value from Meta actions array."""
    if not actions:
        return 0
    for a in actions:
        if a.get("action_type") == action_type:
            return int(float(a.get("value", 0)))
    return 0


def transform_to_bq_rows(insights: list) -> list[dict]:
    """Transform Meta API response to BQ-compatible rows."""
    bq_rows = []
    for row in insights:
        actions = row.get("actions", [])
        bq_rows.append({
            "sync_time": datetime.utcnow().isoformat(),
            "date": row.get("date_start"),
            "ad_id": int(row.get("ad_id", 0)),
            "ad_name": row.get("ad_name", ""),
            "adset_id": int(row.get("adset_id", 0)),
            "adset_name": row.get("adset_name", ""),
            "campaign_id": int(row.get("campaign_id", 0)),
            "campaign_name": row.get("campaign_name", ""),
            "account_id": int(row.get("account_id", "0").replace("act_", "")),
            "spend": float(row.get("spend", 0)),
            "impressions": int(row.get("impressions", 0)),
            "reach": int(row.get("reach", 0)),
            "clicks": int(row.get("clicks", 0)),
            "cpc": float(row.get("cpc", 0) or 0),
            "cpm": float(row.get("cpm", 0) or 0),
            "ctr": float(row.get("ctr", 0) or 0),
            "frequency": float(row.get("frequency", 0) or 0),
            "purchases": extract_action_value(actions, "purchase"),
            "purchase_value": extract_action_value(actions, "purchase") * 0,  # not in Meta response
            "leads": float(extract_action_value(actions, "lead")),
            "messaging_conversations_started": extract_action_value(actions, "onsite_conversion.messaging_conversation_started_7d"),
            "initiate_checkout": extract_action_value(actions, "initiate_checkout"),
            "add_to_cart": extract_action_value(actions, "add_to_cart"),
        })
    return bq_rows


def delete_existing_data(bq_client: bigquery.Client, account_ids: list[str], since: str, until: str):
    """Delete existing data for the date range to avoid duplicates."""
    account_ints = [int(a.replace("act_", "")) for a in account_ids]
    account_list = ", ".join(str(a) for a in account_ints)

    delete_query = f"""
    DELETE FROM `{BQ_PROJECT}.{BQ_DATASET}.{BQ_TABLE}`
    WHERE account_id IN ({account_list})
      AND date BETWEEN '{since}' AND '{until}'
    """
    print(f"  🗑️  Deleting existing data for {since} to {until}...")
    bq_client.query(delete_query).result()
    print(f"  ✅ Old data deleted")


def insert_to_bq(bq_client: bigquery.Client, rows: list[dict]):
    """Insert rows into BigQuery."""
    if not rows:
        print("  ⚠️  No rows to insert")
        return

    table_ref = f"{BQ_PROJECT}.{BQ_DATASET}.{BQ_TABLE}"
    errors = bq_client.insert_rows_json(table_ref, rows)
    if errors:
        print(f"  ❌ BQ insert errors: {errors[:3]}")
    else:
        print(f"  ✅ Inserted {len(rows)} rows into {BQ_TABLE}")


def main():
    parser = argparse.ArgumentParser(description="Sync Meta Ads data to BigQuery")
    parser.add_argument("--days", type=int, default=7, help="Number of days to sync (default: 7)")
    parser.add_argument("--since", type=str, help="Start date (YYYY-MM-DD)")
    parser.add_argument("--until", type=str, help="End date (YYYY-MM-DD), default: today")
    args = parser.parse_args()

    if not ACCESS_TOKEN:
        print("❌ META_ACCESS_TOKEN not found in .env")
        sys.exit(1)

    # Date range
    until_date = datetime.strptime(args.until, "%Y-%m-%d").date() if args.until else datetime.now().date()
    if args.since:
        since_date = datetime.strptime(args.since, "%Y-%m-%d").date()
    else:
        since_date = until_date - timedelta(days=args.days)

    since_str = since_date.strftime("%Y-%m-%d")
    until_str = until_date.strftime("%Y-%m-%d")

    print(f"🔄 Syncing Meta Ads → BigQuery")
    print(f"   Date range: {since_str} to {until_str}")
    print(f"   Accounts: {', '.join(AD_ACCOUNTS)}")
    print()

    # Init BQ client
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = GCP_CREDS
    bq_client = bigquery.Client(project=BQ_PROJECT)

    # Fetch from Meta API
    all_insights = []
    for account in AD_ACCOUNTS:
        print(f"📊 Fetching {account}...")
        insights = fetch_insights(account, since_str, until_str)
        all_insights.extend(insights)
        print(f"   Total: {len(insights)} records")
        print()

    if not all_insights:
        print("⚠️  No data found from Meta API")
        return

    # Transform
    bq_rows = transform_to_bq_rows(all_insights)
    total_spend = sum(r["spend"] for r in bq_rows)
    print(f"📦 Transformed {len(bq_rows)} rows (total spend: {total_spend:,.0f} VND)")

    # Delete existing + Insert
    delete_existing_data(bq_client, AD_ACCOUNTS, since_str, until_str)
    insert_to_bq(bq_client, bq_rows)

    print()
    print(f"✅ Done! Synced {len(bq_rows)} records, spend: {total_spend:,.0f} VND")


if __name__ == "__main__":
    main()
