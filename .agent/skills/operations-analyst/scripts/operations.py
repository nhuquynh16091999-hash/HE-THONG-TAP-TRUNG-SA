#!/usr/bin/env python3
"""
Operations Analyst (A9) — E-commerce Operations Intelligence Tool.

Usage:
    python operations.py --action returns
    python operations.py --action sla
    python operations.py --action stale
    python operations.py --action pipeline
    python operations.py --action forecast
    python operations.py --action lifecycle
    python operations.py --action schema-review
"""

import argparse
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

DATA_FILE = Path(__file__).parent.parent / "data" / "knowledge.json"

def load_data():
    if not DATA_FILE.exists():
        return {}
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

def run_action(action):
    data = load_data()
    print("\n" + "=" * 60)
    print(f"⚙️  OPERATIONS ANALYST (A9): {action.upper()}")
    print("=" * 60)

    if action == "returns":
        print("\n🔄 Return Analysis Signals:")
        for signal in data.get("return_analysis", {}).get("signals", []):
            print(f"   🔍 {signal}")
        print("\n📋 Common Return Reasons:")
        for reason in data.get("return_analysis", {}).get("common_reasons", []):
            print(f"   • {reason}")

    elif action == "sla":
        print("\n⏰ SLA Rules:")
        sla = data.get("sla_monitoring", {}).get("sla_rules", {})
        for key, rule in sla.items():
            print(f"   • {key}: {rule}")
        print("\n📊 Fields Needed:")
        for f in data.get("sla_monitoring", {}).get("fields_needed", []):
            print(f"   - {f}")

    elif action == "stale":
        print("\n🚨 Stale Order Detection:")
        print(f"   Rule: {data.get('stale_order_detection', {}).get('rule', '')}")
        print("\n   Severity Levels:")
        for level, desc in data.get("stale_order_detection", {}).get("severity", {}).items():
            icon = "🟡" if level == "warning" else "🔴" if level == "critical" else "⛔"
            print(f"   {icon} {level}: {desc}")

    elif action == "pipeline":
        print("\n📦 Fulfillment Pipeline Stages:")
        for stage in data.get("fulfillment_pipeline", {}).get("stages", []):
            print(f"   [{stage['status']:>2}] {stage['name']:<15} — expected: {stage['expected_time']}")
        print(f"\n   🔍 {data.get('fulfillment_pipeline', {}).get('bottleneck_detection', '')}")

    elif action == "forecast":
        print("\n🔮 Demand Forecasting (New Skill):")
        fc = data.get("demand_forecasting", {})
        print(f"   📏 Order Point Formula: {fc.get('formula')}")
        print(f"   🛡️ Safety Stock: {fc.get('safety_stock_rule')}")
        print(f"   📉 Stockout Prediction: {fc.get('stockout_prediction')}")
        print(f"   ⚠️ Alert: {fc.get('alert_threshold')}")

    elif action == "schema-review":
        print("\n✅ Schema Review Checklist (Operations):")
        for item in data.get("schema_review_checklist", []):
            print(f"   [ ] {item}")

    elif action == "lifecycle":
        print("\n📊 Order Lifecycle:")
        for group, info in data.get("order_lifecycle", {}).items():
            statuses = info.get("statuses", [])
            names = info.get("names", [])
            print(f"\n   {group.upper()} — statuses {statuses}")
            for s, n in zip(statuses, names):
                print(f"      [{s:>2}] {n}")
            if "alert_rule" in info:
                print(f"      ⚠️  {info['alert_rule']}")
    else:
        print(f"Unknown action: {action}")

    print("\n" + "=" * 60 + "\n")

def main():
    parser = argparse.ArgumentParser(description="Operations Analyst (A9)")
    parser.add_argument("--action", type=str, required=True,
                        choices=["returns", "sla", "stale", "pipeline", "forecast", "schema-review", "lifecycle"])
    args = parser.parse_args()
    run_action(args.action)

if __name__ == "__main__":
    main()
