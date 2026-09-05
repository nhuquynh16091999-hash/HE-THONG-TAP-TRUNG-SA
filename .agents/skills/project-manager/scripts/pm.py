#!/usr/bin/env python3
"""
Project Manager Agent — Agile Workflow Automation.

Usage:
    python pm.py --action prd
    python pm.py --action stories
    python pm.py --action sprint
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
    print(f"📋 PROJECT MANAGER AGENT: {action.upper()}")
    print("=" * 60)

    if action == "prd":
        print("\n📄 PRD Generator Template:")
        for section in data.get("prd_template", {}).get("structure", []):
            print(f"   {section}")
        print(f"\n   💡 Example Goal: {data.get('prd_template', {}).get('example_goal')}")

    elif action == "stories":
        print("\n📝 User Story Mapping:")
        us = data.get("user_story_mapping", {})
        print(f"   Format: {us.get('format')}")
        print(f"   Acceptance Criteria: {us.get('acceptance_criteria_format')}")
        print("\n   Example:")
        print(f"   Story: {us.get('example', {}).get('story')}")
        print(f"   AC: {us.get('example', {}).get('ac')}")

    elif action == "sprint":
        print("\n🏃 Sprint Planning Rules:")
        sp = data.get("sprint_planning", {})
        print(f"   Duration: {sp.get('sprint_duration')}")
        print(f"   Points: {sp.get('story_point_scale')}")
        print("\n   ⚖️  Team Capacity:")
        for role, cap in sp.get("capacity_rules", {}).items():
            print(f"   • {role}: {cap}")
        print(f"\n   🔥 Prioritization: {sp.get('prioritization_framework')}")

    else:
        print(f"Unknown action: {action}")

    print("\n" + "=" * 60 + "\n")

def main():
    parser = argparse.ArgumentParser(description="Project Manager Agent")
    parser.add_argument("--action", type=str, required=True,
                        choices=["prd", "stories", "sprint"],
                        help="PM action")
    args = parser.parse_args()
    run_action(args.action)

if __name__ == "__main__":
    main()
