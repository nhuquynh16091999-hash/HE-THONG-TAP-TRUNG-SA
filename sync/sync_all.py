#!/usr/bin/env python3
"""
FAOS — TALPHA Sync Orchestrator

Runs data sync for TALPHA project:
  - TALPHA: Orders (Poscake 6 shops GCC) + FB Ads (8 accounts)

Usage:
  python sync/sync_all.py                    # Full sync
  python sync/sync_all.py --orders           # Orders only
  python sync/sync_all.py --ads              # Ads only
  python sync/sync_all.py --days 7           # Ads backfill 7 days
  python sync/sync_all.py --test             # Test connections
"""
import os
import sys
import subprocess
import logging
import argparse
import json
from datetime import datetime
from pathlib import Path

# Setup
PROJECT_ROOT = Path(__file__).parent.parent
PYTHON = sys.executable
HISTORY_FILE = PROJECT_ROOT / "logs" / "sync_history.json"
MAX_HISTORY = 500

os.makedirs(PROJECT_ROOT / "logs", exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger("sync_all")

# ═══ Project Definitions ═══
PROJECTS = [
    {
        "id": "talpha",
        "name": "TALPHA",
        "script": str(PROJECT_ROOT / "sync" / "talpha" / "talpha_sync.py"),
        "has_orders": True,
        "has_ads": True,
    },
]


def load_history():
    """Load existing sync history."""
    if HISTORY_FILE.exists():
        try:
            with open(HISTORY_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return []


def save_history(history):
    """Save sync history (max MAX_HISTORY entries)."""
    history = history[-MAX_HISTORY:]
    with open(HISTORY_FILE, "w", encoding="utf-8") as f:
        json.dump(history, f, indent=2, ensure_ascii=False)


def run_sync(project, mode="full", days=1, test=False):
    """Run sync for a single project."""
    pid = project["id"]
    name = project["name"]

    start = datetime.now()
    result = {"project": pid, "name": name, "mode": mode, "start": start.isoformat()}

    log.info(f"{'═' * 50}")
    log.info(f"  {name} — {mode.upper()} sync")
    log.info(f"{'═' * 50}")

    try:
        # T1 uses separate scripts for orders/ads
        if "orders_script" in project:
            # T1 pattern: separate scripts
            if mode in ("full", "orders") and project.get("has_orders"):
                log.info(f"  [{name}] Syncing orders...")
                r = subprocess.run(
                    [PYTHON, project["orders_script"]],
                    capture_output=True, text=True, timeout=600,
                )
                log.info(f"  [{name}] Orders: exit={r.returncode}")
                if r.stdout:
                    for line in r.stdout.strip().split("\n")[-3:]:
                        log.info(f"    {line}")
                if r.returncode != 0 and r.stderr:
                    log.error(f"    Error: {r.stderr[:200]}")
                result["orders"] = "ok" if r.returncode == 0 else "error"

            if mode in ("full", "ads") and project.get("has_ads"):
                log.info(f"  [{name}] Syncing ads...")
                r = subprocess.run(
                    [PYTHON, project["ads_script"]],
                    capture_output=True, text=True, timeout=600,
                )
                log.info(f"  [{name}] Ads: exit={r.returncode}")
                if r.stdout:
                    for line in r.stdout.strip().split("\n")[-3:]:
                        log.info(f"    {line}")
                result["ads"] = "ok" if r.returncode == 0 else "error"
        else:
            # STRAMARK/AUUS1/TALPHA pattern: single script with --ads/--orders
            args = [PYTHON, project["script"]]
            if test:
                args.append("--test")
            elif mode == "orders" and project.get("has_orders"):
                args.append("--orders")
            elif mode == "ads" and project.get("has_ads"):
                args.extend(["--ads", "--days", str(days)])
            else:
                args.extend(["--days", str(days)])

            r = subprocess.run(
                args, capture_output=True, text=True, timeout=600,
            )
            log.info(f"  [{name}] exit={r.returncode}")
            if r.stdout:
                for line in r.stdout.strip().split("\n")[-5:]:
                    log.info(f"    {line}")
            if r.returncode != 0 and r.stderr:
                log.error(f"    Error: {r.stderr[:200]}")
            result["status"] = "ok" if r.returncode == 0 else "error"

    except subprocess.TimeoutExpired:
        log.error(f"  [{name}] TIMEOUT!")
        result["status"] = "timeout"
    except Exception as e:
        log.error(f"  [{name}] Error: {e}")
        result["status"] = f"error: {e}"

    result["elapsed_s"] = round((datetime.now() - start).total_seconds(), 1)
    return result


def main():
    parser = argparse.ArgumentParser(description="FAOS v6 Unified Sync")
    parser.add_argument("--project", type=str, help="Sync single project (stramark/t1/auus1/talpha)")
    parser.add_argument("--orders", action="store_true", help="Orders sync only")
    parser.add_argument("--ads", action="store_true", help="Ads sync only")
    parser.add_argument("--test", action="store_true", help="Test connections")
    parser.add_argument("--days", type=int, default=1, help="Days back for ads (default: 1)")
    args = parser.parse_args()

    mode = "full"
    if args.orders:
        mode = "orders"
    elif args.ads:
        mode = "ads"

    # Filter projects
    projects = PROJECTS
    if args.project:
        projects = [p for p in PROJECTS if p["id"] == args.project.lower()]
        if not projects:
            log.error(f"Unknown project: {args.project}")
            log.info(f"Available: {', '.join(p['id'] for p in PROJECTS)}")
            sys.exit(1)

    log.info(f"FAOS v6 Sync — {mode.upper()} | Projects: {', '.join(p['name'] for p in projects)}")
    log.info(f"Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

    history = load_history()
    results = []

    for project in projects:
        result = run_sync(project, mode=mode, days=args.days, test=args.test)
        results.append(result)
        history.append(result)

    save_history(history)

    # Summary
    log.info(f"\n{'═' * 50}")
    log.info("SYNC SUMMARY")
    for r in results:
        status = r.get("status", "ok")
        log.info(f"  {r['name']:12} | {status:8} | {r.get('elapsed_s', 0):.1f}s")
    log.info(f"{'═' * 50}")


if __name__ == "__main__":
    main()
