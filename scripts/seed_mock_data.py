"""Seed mock data into BigQuery for Audit Dashboard testing."""
import os
import sys
import random
import uuid
from datetime import datetime, timedelta

os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = "/opt/faos/bigquery_key.json"

from google.cloud import bigquery

client = bigquery.Client(project="levelup-465304")
dataset = "STRAMARK_Dataset"
full_dataset = f"levelup-465304.{dataset}"

# Check existing tables
tables = [t.table_id for t in client.list_tables(full_dataset)]
print(f"Tables: {tables}")

DATE_FMT = "%Y-%m-%d"


def ensure_table(name, schema):
    if name not in tables:
        table = bigquery.Table(f"{full_dataset}.{name}", schema=schema)
        client.create_table(table, exists_ok=True)
        print(f"Created table: {name}")
    return True


# --- ai_prediction_log ---
ensure_table("ai_prediction_log", [
    bigquery.SchemaField("prediction_id", "STRING"),
    bigquery.SchemaField("project_id", "STRING"),
    bigquery.SchemaField("report_date", "DATE"),
    bigquery.SchemaField("agent", "STRING"),
    bigquery.SchemaField("prediction_type", "STRING"),
    bigquery.SchemaField("predicted_value", "FLOAT"),
    bigquery.SchemaField("actual_value", "FLOAT"),
    bigquery.SchemaField("accuracy_pct", "FLOAT"),
    bigquery.SchemaField("confidence_score", "FLOAT"),
    bigquery.SchemaField("context_snapshot", "STRING"),
    bigquery.SchemaField("created_at", "TIMESTAMP"),
])

predictions = []
for i in range(1, 6):
    d = (datetime.utcnow() - timedelta(days=i)).strftime(DATE_FMT)
    accuracy = round(random.uniform(70, 95), 1)
    predictions.append({
        "prediction_id": f"pred_mock_{d}_{uuid.uuid4().hex[:8]}",
        "project_id": "stramark",
        "report_date": d,
        "agent": "executive_analyst",
        "prediction_type": "revenue_trend",
        "predicted_value": round(random.uniform(5000, 15000), 2),
        "actual_value": round(random.uniform(5000, 15000), 2),
        "accuracy_pct": accuracy,
        "confidence_score": round(random.uniform(0.7, 0.95), 2),
        "context_snapshot": "{}",
        "created_at": datetime.utcnow().isoformat(),
    })

errors = client.insert_rows_json(f"{full_dataset}.ai_prediction_log", predictions)
if errors:
    print(f"Prediction errors: {errors}")
else:
    print(f"✅ Inserted {len(predictions)} ai_prediction_log records (T-1 to T-5)")

# --- approval_logs ---
ensure_table("approval_logs", [
    bigquery.SchemaField("decision_id", "STRING"),
    bigquery.SchemaField("project_id", "STRING"),
    bigquery.SchemaField("run_id", "STRING"),
    bigquery.SchemaField("action_type", "STRING"),
    bigquery.SchemaField("campaign_id", "STRING"),
    bigquery.SchemaField("status", "STRING"),
    bigquery.SchemaField("risk_level", "FLOAT"),
    bigquery.SchemaField("percentage_change", "FLOAT"),
    bigquery.SchemaField("decided_by", "STRING"),
    bigquery.SchemaField("decided_at", "TIMESTAMP"),
    bigquery.SchemaField("channel", "STRING"),
    bigquery.SchemaField("outcome_verdict", "STRING"),
    bigquery.SchemaField("created_at", "TIMESTAMP"),
])

verdicts = ["POSITIVE", "NEGATIVE", "NEUTRAL"]
actions = ["scale_budget", "pause_adset", "new_campaign"]
logs = []
for i, (verdict, action) in enumerate(zip(verdicts, actions)):
    d = datetime.utcnow() - timedelta(days=i + 1)
    d_str = d.strftime(DATE_FMT)
    logs.append({
        "decision_id": f"dec_mock_{d_str}_{uuid.uuid4().hex[:6]}",
        "project_id": "stramark",
        "run_id": f"run_mock_{uuid.uuid4().hex[:8]}",
        "action_type": action,
        "campaign_id": f"camp_{random.randint(100000, 999999)}",
        "status": "AUTO_APPROVED",
        "risk_level": round(random.uniform(0.1, 0.8), 2),
        "percentage_change": round(random.uniform(-20, 30), 1),
        "decided_by": "ai:director",
        "decided_at": d.isoformat(),
        "channel": "system",
        "outcome_verdict": verdict,
        "created_at": d.isoformat(),
    })

errors = client.insert_rows_json(f"{full_dataset}.approval_logs", logs)
if errors:
    print(f"Approval errors: {errors}")
else:
    print(f"✅ Inserted {len(logs)} approval_logs records (WIN/LOSS/NEUTRAL)")

print("\nDONE — Mock data seeded.")
