"""
Deploy SQL views to BigQuery.
Reads .sql files from sql/views/ and creates/replaces the views.
"""
import os, sys, glob
from google.cloud import bigquery
from dotenv import load_dotenv

sys.stdout.reconfigure(encoding='utf-8')
load_dotenv()

P = os.getenv("BQ_PROJECT_ID", "levelup-465304")
SQL_DIR = os.path.join(os.path.dirname(__file__), "views")


def deploy_view(client, sql_file):
    name = os.path.basename(sql_file).replace('.sql', '')
    print(f"\n{'='*50}")
    print(f"📋 Deploying: {name}")
    print(f"{'='*50}")

    with open(sql_file, 'r', encoding='utf-8') as f:
        sql = f.read()

    # Strip comments at top
    lines = sql.strip().split('\n')
    sql_clean = '\n'.join(l for l in lines if not l.strip().startswith('--'))

    try:
        client.query(sql_clean).result()
        print(f"  ✅ View deployed: FAOS_V2.{name}")
    except Exception as e:
        print(f"  ❌ Error: {e}")


def main():
    print("🚀 Deploying BigQuery Views")
    client = bigquery.Client()

    sql_files = sorted(glob.glob(os.path.join(SQL_DIR, "*.sql")))
    if not sql_files:
        print("⚠️ No .sql files found in sql/views/")
        return

    for f in sql_files:
        deploy_view(client, f)

    print(f"\n✅ Deployed {len(sql_files)} views!")


if __name__ == "__main__":
    main()
