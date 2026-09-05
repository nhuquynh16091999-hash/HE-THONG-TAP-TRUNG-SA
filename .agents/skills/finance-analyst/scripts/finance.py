#!/usr/bin/env python3
"""
Finance Analyst (A10) — E-commerce Finance Intelligence Tool.

Usage:
    python finance.py --action pnl
    python finance.py --action reconciliation
    python finance.py --action payment-mix
    python finance.py --action margin
    python finance.py --action cash-flow
    python finance.py --action schema-review
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
    print(f"💰 FINANCE ANALYST (A10): {action.upper()}")
    print("=" * 60)

    if action == "pnl":
        print("\n📊 P&L Formula (Cross-border COD):")
        pnl = data.get("pnl_formula", {})
        for key, formula in pnl.items():
            icon = "💵" if "revenue" in key else "📦" if "cogs" in key else "📈" if "profit" in key else "💸"
            print(f"   {icon} {key}: {formula}")
        print("\n⚠️  Revenue Recognition Rules:")
        rev = data.get("revenue_recognition", {})
        print(f"   ✅ Success statuses: {rev.get('success_statuses')}")
        print(f"   ⚠️  Partial return (status 15): {rev.get('partial_return_rule')}")
        print(f"   ❌ Excluded: {rev.get('excluded_statuses')} — {rev.get('excluded_reason')}")

    elif action == "reconciliation":
        print("\n🔍 COD Reconciliation Triangle:")
        rec = data.get("reconciliation", {})
        print(f"   Formula: {rec.get('formula')}")
        print(f"   Alert: {rec.get('alert_threshold')}")
        print("\n   Sources:")
        for key, desc in rec.get("sources", {}).items():
            print(f"   • {key}: {desc}")

    elif action == "payment-mix":
        print("\n💳 Payment Methods:")
        for method, desc in data.get("payment_methods", {}).items():
            print(f"   • {method}: {desc}")

    elif action == "margin":
        print("\n📈 KPI Definitions:")
        for kpi, formula in data.get("kpi_definitions", {}).items():
            print(f"   • {kpi}: {formula}")

    elif action == "cash-flow":
        print("\n💸 Cash Flow Forecasting (New Skill):")
        print("   Predicts when COD money will hit the bank account.")
        cf = data.get("cash_flow_forecasting", {})
        print(f"\n   🔄 COD Cycles (Days):")
        for type, days in cf.get("cod_cycle_days", {}).items():
            print(f"      • {type}: {days} days")
        print(f"\n   📅 Remittance Days: {', '.join(cf.get('remittance_days', []))}")
        print(f"   📝 Formula: {cf.get('formula')}")
        print(f"   ⚠️ Impact: {cf.get('hold_time_impact')}")

    elif action == "schema-review":
        print("\n✅ Schema Review Checklist:")
        for item in data.get("schema_review_checklist", []):
            print(f"   [ ] {item}")
        print("\n💱 Currency Handling:")
        cur = data.get("currency_handling", {})
        print(f"   Rule: {cur.get('rule')}")
        print(f"   Affected fields ({len(cur.get('affected_fields', []))}): {', '.join(cur.get('affected_fields', [])[:5])}...")
    else:
        print(f"Unknown action: {action}")

    print("\n" + "=" * 60 + "\n")

def main():
    parser = argparse.ArgumentParser(description="Finance Analyst (A10)")
    parser.add_argument("--action", type=str, required=True,
                        choices=["pnl", "reconciliation", "payment-mix", "margin", "cash-flow", "schema-review"],
                        help="Finance analysis action")
    args = parser.parse_args()
    run_action(args.action)

if __name__ == "__main__":
    main()
