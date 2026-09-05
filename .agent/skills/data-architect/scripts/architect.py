#!/usr/bin/env python3
"""
Data Architect — BigQuery Schema & Performance Intelligence Tool.

Usage:
    python architect.py --action schema
    python architect.py --action partitioning
    python architect.py --action cost
    python architect.py --action views
    python architect.py --action quality
    python architect.py --action schema-review
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
    print(f"🗄️  DATA ARCHITECT: {action.upper()}")
    print("=" * 60)

    if action == "schema":
        print("\n📐 Schema Design Principles:")
        star = data.get("schema_design_principles", {}).get("star_schema", {})
        print(f"\n   Fact tables: {star.get('fact_tables')}")
        print(f"   Dimension tables: {star.get('dimension_tables')}")
        print(f"   Rule: {star.get('rule')}")
        print("\n   📝 Naming Convention:")
        for key, rule in data.get("schema_design_principles", {}).get("naming_convention", {}).items():
            print(f"      • {key}: {rule}")
        print("\n   🔤 Data Types:")
        for dtype, rule in data.get("schema_design_principles", {}).get("data_types", {}).items():
            print(f"      • {dtype}: {rule}")

    elif action == "partitioning":
        print("\n📊 Partitioning Strategy:")
        for table, config in data.get("partitioning_strategy", {}).items():
            print(f"\n   📋 {table}:")
            print(f"      PARTITION BY: {config.get('partition_by', 'None')}")
            print(f"      CLUSTER BY: {config.get('cluster_by', 'None')}")
            print(f"      Rationale: {config.get('rationale')}")

    elif action == "cost":
        cost = data.get("cost_estimation", {})
        print(f"\n   💰 Pricing: {cost.get('pricing')}")
        print("\n   📏 Typical Scan Sizes:")
        for query, size in cost.get("typical_scan_sizes", {}).items():
            print(f"      • {query}: {size}")
        print("\n   🚀 Optimization Rules:")
        for rule in cost.get("optimization_rules", []):
            print(f"      • {rule}")

    elif action == "views":
        print("\n🔧 View Design Patterns:")
        for pattern, desc in data.get("view_patterns", {}).items():
            print(f"\n   • {pattern}:")
            print(f"     {desc}")

    elif action == "quality":
        print("\n✅ Data Quality Rules:")
        for rule in data.get("data_quality_rules", []):
            print(f"   [ ] {rule}")

    elif action == "schema-review":
        print("\n✅ Schema Review Checklist (Architecture):")
        for item in data.get("schema_review_checklist", []):
            print(f"   [ ] {item}")
    else:
        print(f"Unknown action: {action}")

    print("\n" + "=" * 60 + "\n")

def main():
    parser = argparse.ArgumentParser(description="Data Architect")
    parser.add_argument("--action", type=str, required=True,
                        choices=["schema", "partitioning", "cost", "views", "quality", "schema-review"])
    args = parser.parse_args()
    run_action(args.action)

if __name__ == "__main__":
    main()
