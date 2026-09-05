#!/usr/bin/env python3
"""
Tech Lead Agent — Automated Quality Gatekeeper.

Usage:
    python tech_lead.py --action review
    python tech_lead.py --action adr
    python tech_lead.py --action stack
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
    print(f"🏗️  TECH LEAD AGENT: {action.upper()}")
    print("=" * 60)

    if action == "review":
        print("\n🧐 Automated Code Review Checklist:")
        cr = data.get("code_review_automator", {})
        for item in cr.get("checklist", []):
            print(f"   [ ] {item}")
        print("\n   🚦 Severity Levels:")
        for level, desc in cr.get("severity_levels", {}).items():
            icon = "⛔" if level == "blocker" else "🔴" if level == "critical" else "🟡"
            print(f"   {icon} {level.upper()}: {desc}")

    elif action == "adr":
        print("\n📜 ADR Generator (Architecture Decision Record):")
        adr = data.get("adr_template", {})
        for section in adr.get("structure", []):
            print(f"   {section}")
        print(f"\n   💡 Example: {adr.get('example_decision')}")

    elif action == "stack":
        print("\n🧱 Approved Tech Stack:")
        stack = data.get("tech_stack_standards", {})
        for cat, items in stack.items():
            if isinstance(items, list):
                if cat == "forbidden_patterns":
                    print(f"\n   🚫 Forbidden: {', '.join(items)}")
                else:
                    print(f"   ✅ {cat.title()}: {', '.join(items)}")

    else:
        print(f"Unknown action: {action}")

    print("\n" + "=" * 60 + "\n")

def main():
    parser = argparse.ArgumentParser(description="Tech Lead Agent")
    parser.add_argument("--action", type=str, required=True,
                        choices=["review", "adr", "stack"],
                        help="Tech Lead action")
    args = parser.parse_args()
    run_action(args.action)

if __name__ == "__main__":
    main()
