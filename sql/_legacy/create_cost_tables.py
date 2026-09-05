"""
Create and populate cost tables in FAOS_V2 from CSV config files.
Run this after filling in the CSV files in config/
"""
import os, sys, csv
from google.cloud import bigquery
from dotenv import load_dotenv

sys.stdout.reconfigure(encoding='utf-8')
load_dotenv()

P = os.getenv("BQ_PROJECT_ID", "levelup-465304")
D = "FAOS_V2"
CONFIG_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "config")

TABLES = {
    "cost_product_cogs": {
        "csv": "cost_product_cogs.csv",
        "schema": [
            bigquery.SchemaField("product_id", "STRING", mode="REQUIRED"),
            bigquery.SchemaField("product_name", "STRING"),
            bigquery.SchemaField("project_id", "STRING", mode="REQUIRED"),
            bigquery.SchemaField("cost_price", "FLOAT64"),
            bigquery.SchemaField("currency", "STRING"),
            bigquery.SchemaField("valid_from", "DATE"),
            bigquery.SchemaField("valid_to", "DATE"),
        ],
    },
    "cost_ffm_fees": {
        "csv": "cost_ffm_fees.csv",
        "schema": [
            bigquery.SchemaField("partner_3pl", "STRING"),
            bigquery.SchemaField("project_id", "STRING", mode="REQUIRED"),
            bigquery.SchemaField("market_code", "STRING"),
            bigquery.SchemaField("market_name", "STRING"),
            bigquery.SchemaField("ffm_fee_per_order", "FLOAT64"),
            bigquery.SchemaField("cod_fee_pct", "FLOAT64"),
            bigquery.SchemaField("weight_fee_per_kg", "FLOAT64"),
            bigquery.SchemaField("currency", "STRING"),
            bigquery.SchemaField("valid_from", "DATE"),
            bigquery.SchemaField("valid_to", "DATE"),
        ],
    },
    "cost_shipping": {
        "csv": "cost_shipping.csv",
        "schema": [
            bigquery.SchemaField("partner_3pl", "STRING"),
            bigquery.SchemaField("from_warehouse", "STRING"),
            bigquery.SchemaField("to_market", "STRING"),
            bigquery.SchemaField("cost_per_order", "FLOAT64"),
            bigquery.SchemaField("cost_per_kg", "FLOAT64"),
            bigquery.SchemaField("currency", "STRING"),
            bigquery.SchemaField("valid_from", "DATE"),
            bigquery.SchemaField("valid_to", "DATE"),
        ],
    },
    "cost_exchange_rates": {
        "csv": "cost_exchange_rates.csv",
        "schema": [
            bigquery.SchemaField("from_currency", "STRING"),
            bigquery.SchemaField("to_currency", "STRING"),
            bigquery.SchemaField("rate", "FLOAT64"),
            bigquery.SchemaField("valid_from", "DATE"),
            bigquery.SchemaField("valid_to", "DATE"),
        ],
    },
    "cost_fixed": {
        "csv": "cost_fixed.csv",
        "schema": [
            bigquery.SchemaField("project_id", "STRING", mode="REQUIRED"),
            bigquery.SchemaField("category", "STRING"),
            bigquery.SchemaField("description", "STRING"),
            bigquery.SchemaField("amount", "FLOAT64"),
            bigquery.SchemaField("currency", "STRING"),
            bigquery.SchemaField("month", "INT64"),
            bigquery.SchemaField("year", "INT64"),
        ],
    },
}


def load_csv(filename):
    """Read CSV file and return list of dicts."""
    path = os.path.join(CONFIG_DIR, filename)
    if not os.path.exists(path):
        print(f"  ⚠️ Not found: {path}")
        return []
    with open(path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        rows = []
        for row in reader:
            # Clean empty strings to None
            cleaned = {}
            for k, v in row.items():
                if v == "" or v is None:
                    cleaned[k] = None
                else:
                    cleaned[k] = v
            rows.append(cleaned)
        return rows


def create_and_populate(client, table_name, config):
    """Create table if not exists, then populate from CSV."""
    table_id = f"{P}.{D}.{table_name}"
    
    print(f"\n{'='*50}")
    print(f"📋 {table_name}")
    print(f"{'='*50}")
    
    # Create or replace table
    table = bigquery.Table(table_id, schema=config["schema"])
    table = client.create_table(table, exists_ok=True)
    print(f"  ✅ Table ready: {table_id}")
    
    # Load data from CSV
    rows = load_csv(config["csv"])
    if not rows:
        print(f"  ⚠️ No data in {config['csv']}")
        return
    
    # Delete existing data and insert fresh
    client.query(f"DELETE FROM `{table_id}` WHERE TRUE").result()
    
    # Insert rows
    errors = client.insert_rows_json(table_id, rows)
    if errors:
        print(f"  ❌ Insert errors: {errors}")
    else:
        print(f"  ✅ Loaded {len(rows)} rows from {config['csv']}")


def main():
    print("🏗️ FAOS Cost Tables — Create & Populate from CSV Config")
    print(f"Project: {P} | Dataset: {D}")
    print(f"Config dir: {CONFIG_DIR}")
    
    client = bigquery.Client()
    
    for table_name, config in TABLES.items():
        create_and_populate(client, table_name, config)
    
    print(f"\n{'='*50}")
    print("✅ All cost tables ready!")
    print(f"{'='*50}")
    print("\n📝 Cách sử dụng:")
    print("  1. Sửa file CSV trong config/")
    print("  2. Chạy lại: python sql/create_cost_tables.py")
    print("  3. Data sẽ được thay thế hoàn toàn")


if __name__ == "__main__":
    main()
