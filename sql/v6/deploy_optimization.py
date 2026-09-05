"""
Deploy Ads Optimization SQL to STRAMARK_Dataset.

Creates tables + views for the optimization intelligence module.
Uses bigquery_key.json for authentication (same as all other deploy scripts).
"""

import os
import sys

os.environ['GOOGLE_APPLICATION_CREDENTIALS'] = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    'bigquery_key.json'
)

from google.cloud import bigquery

PROJECT = "levelup-465304"
DATASET = "STRAMARK_Dataset"

client = bigquery.Client(project=PROJECT)


def run_sql(name: str, sql: str) -> None:
    """Execute a SQL statement."""
    print(f"\n{'='*60}")
    print(f"Deploying: {name}")
    print(f"{'='*60}")
    try:
        job = client.query(sql)
        job.result()
        print(f"✅ {name} — SUCCESS")
    except Exception as e:
        print(f"❌ {name} — FAILED: {e}")
        raise


def read_sql_file(path: str) -> str:
    """Read SQL file and replace {DATASET} placeholder."""
    with open(path, 'r') as f:
        return f.read().replace('{DATASET}', DATASET)


def main():
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    # ── Step 1: Create tables ──
    print("\n🔧 STEP 1: Creating tables...")

    table_sql = read_sql_file(os.path.join(base, 'sql/v6/tables/fact_ads_optimization.sql'))
    run_sql("fact_ads_optimization", table_sql)

    event_sql = read_sql_file(os.path.join(base, 'sql/v6/tables/ads_metric_event_log.sql'))
    run_sql("ads_metric_event_log", event_sql)

    # ── Step 2: Create views ──
    print("\n🔧 STEP 2: Creating views...")

    diag_sql = read_sql_file(os.path.join(base, 'sql/v6/views/vw_campaign_diagnostic.sql'))
    run_sql("vw_campaign_diagnostic", diag_sql)

    funnel_sql = read_sql_file(os.path.join(base, 'sql/v6/views/vw_spend_funnel.sql'))
    run_sql("vw_spend_funnel", funnel_sql)

    # ── Step 3: Verify ──
    print("\n🔧 STEP 3: Verifying...")

    # Check tables exist
    for table_name in ['fact_ads_optimization', 'ads_metric_event_log']:
        table_ref = client.dataset(DATASET).table(table_name)
        try:
            table = client.get_table(table_ref)
            print(f"✅ Table {table_name}: {table.num_rows} rows, {len(table.schema)} columns")
        except Exception as e:
            print(f"⚠️ Table {table_name}: {e}")

    # Check views exist (query with LIMIT 0)
    for view_name in ['vw_campaign_diagnostic', 'vw_spend_funnel']:
        try:
            # Views need partition filter — use a date filter
            q = f"""
            SELECT COUNT(*) as cnt
            FROM `{PROJECT}.{DATASET}.{view_name}`
            """
            rows = list(client.query(q).result())
            cnt = rows[0].cnt if rows else 0
            print(f"✅ View {view_name}: {cnt} rows")
        except Exception as e:
            print(f"⚠️ View {view_name}: {e}")

    print("\n" + "="*60)
    print("🎉 DEPLOYMENT COMPLETE")
    print("="*60)


if __name__ == "__main__":
    main()
