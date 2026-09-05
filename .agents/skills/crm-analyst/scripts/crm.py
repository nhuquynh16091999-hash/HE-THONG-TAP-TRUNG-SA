#!/usr/bin/env python3
"""
CRM Analyst (A8) — Customer Intelligence Tool.

Usage:
    python crm.py --action rfm
    python crm.py --action fraud
    python crm.py --action health
    python crm.py --action churn
    python crm.py --action audience
    python crm.py --action schema-review
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
    print(f"👥 CRM ANALYST (A8): {action.upper()}")
    print("=" * 60)

    if action == "rfm":
        rfm = data.get("rfm_model", {})
        for dim in ["recency", "frequency", "monetary"]:
            info = rfm.get(dim, {})
            print(f"\n   📊 {dim.upper()} — field: {info.get('field')}")
            for score, desc in info.get("scoring", {}).items():
                print(f"      [{score}] {desc}")
        print("\n   🏷️ Customer Segments:")
        for seg, desc in rfm.get("segments", {}).items():
            print(f"      • {seg}: {desc}")

    elif action == "fraud":
        print("\n🚨 Fraud Detection Signals:")
        for signal in data.get("fraud_detection", {}).get("signals", []):
            print(f"\n   🔍 {signal['name']}")
            print(f"      Rule: {signal['rule']}")
            print(f"      Action: {signal['action']}")
        formula = data.get("fraud_detection", {}).get("fraud_risk_score_formula", "")
        print(f"\n   📐 Score Formula: {formula}")

    elif action == "health":
        print("\n💚 Customer Health Stages:")
        for stage, desc in data.get("customer_health", {}).get("lifecycle_stages", {}).items():
            icon = "🌟" if "vip" in stage else "🔄" if "repeat" in stage else "🆕" if "new" in stage else "⚠️" if "risk" in stage else "💀"
            print(f"   {icon} {stage}: {desc}")
        print(f"\n   📐 Formula: {data.get('customer_health', {}).get('formula', '')[:80]}...")

    elif action == "churn":
        health = data.get("customer_health", {}).get("lifecycle_stages", {})
        print("\n📉 Churn Indicators:")
        print(f"   ⚠️  At Risk: {health.get('at_risk', '')}")
        print(f"   💀 Churned: {health.get('churned', '')}")
        print("\n   🛡️ Win-back Strategies:")
        print("      • at_risk: Send personalized discount email/SMS")
        print("      • churned: Deep discount + new product showcase")
        print("      • blocked: Do not re-engage")

    elif action == "audience":
        print("\n🎯 Audience Export Strategy (New Skill):")
        print("   Expert Logic: Sync high-value segments to Ad Platforms.")
        aud = data.get("audience_export", {})
        for seg in aud.get("segments_to_export", []):
            print(f"\n   📂 {seg['name']}")
            print(f"      Criteria: {seg['criteria']}")
            print(f"      Destination: {seg['dest']}")
        print(f"\n   🔄 Sync Frequency: {aud.get('sync_frequency')}")

    elif action == "schema-review":
        print("\n✅ Schema Review Checklist (CRM):")
        for item in data.get("schema_review_checklist", []):
            print(f"   [ ] {item}")
    else:
        print(f"Unknown action: {action}")

    print("\n" + "=" * 60 + "\n")

def main():
    parser = argparse.ArgumentParser(description="CRM Analyst (A8)")
    parser.add_argument("--action", type=str, required=True,
                        choices=["rfm", "fraud", "health", "churn", "schema-review", "audience"])
    args = parser.parse_args()
    run_action(args.action)

if __name__ == "__main__":
    main()
