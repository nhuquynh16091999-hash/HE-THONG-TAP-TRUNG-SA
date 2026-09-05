#!/usr/bin/env python3
"""
FAOS v6 — Ads Optimization Sync Runner.

Called by cron to run sync tiers:
  python3 run_ads_sync.py --tier hot
  python3 run_ads_sync.py --tier cold
  python3 run_ads_sync.py --tier warm
  python3 run_ads_sync.py --tier once
  python3 run_ads_sync.py --tier all
"""

import os, sys, asyncio, argparse, logging
from datetime import datetime, date as date_type

sys.path.insert(0, '/opt/faos')
os.environ.setdefault('GOOGLE_APPLICATION_CREDENTIALS', '/opt/faos/bigquery_key.json')

# Load .env
from dotenv import load_dotenv
load_dotenv('/opt/faos/.env')

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)


async def run_sync(project: str, tiers: list, target_date=None):
    """Run sync for specified tiers."""
    from google.cloud import bigquery
    from faos_brain.optimization.sync import SmartSync, SyncTier

    bq = bigquery.Client()
    sync = SmartSync(project_id=project, bq_client=bq)

    tier_map = {
        'hot': SyncTier.HOT,
        'cold': SyncTier.COLD,
        'warm': SyncTier.WARM,
        'once': SyncTier.ONCE,
    }

    for t in tiers:
        tier_enum = tier_map.get(t)
        if not tier_enum:
            logger.warning(f"Unknown tier: {t}")
            continue

        logger.info(f"[{project}] Starting {t.upper()} sync...")
        start = datetime.now()

        try:
            if t == 'hot':
                result = await sync.sync_hot(target_date)
            elif t == 'cold':
                result = await sync.sync_cold(target_date)
            elif t == 'warm':
                result = await sync.sync_warm()
            elif t == 'once':
                result = await sync.sync_creative_metadata()
            else:
                continue

            elapsed = (datetime.now() - start).total_seconds()
            logger.info(
                f"[{project}] {t.upper()} done: "
                f"{result.rows_processed} processed, "
                f"{result.rows_inserted} inserted, "
                f"{elapsed:.1f}s"
            )
            if result.errors:
                for err in result.errors:
                    logger.error(f"[{project}] {t.upper()} error: {err}")

        except Exception as e:
            logger.error(f"[{project}] {t.upper()} FAILED: {e}")


def main():
    parser = argparse.ArgumentParser(description='FAOS Ads Optimization Sync')
    parser.add_argument('--tier', required=True,
                       choices=['hot', 'cold', 'warm', 'once', 'all'],
                       help='Sync tier to run')
    parser.add_argument('--project', default='stramark',
                       help='Project ID (default: stramark)')
    parser.add_argument('--date',
                       help='Target date YYYY-MM-DD (default: today)')
    args = parser.parse_args()

    target_date = None
    if args.date:
        target_date = date_type.fromisoformat(args.date)

    if args.tier == 'all':
        tiers = ['hot', 'cold', 'warm', 'once']
    else:
        tiers = [args.tier]

    logger.info(f"Starting sync: project={args.project}, tiers={tiers}, date={target_date or 'today'}")
    asyncio.run(run_sync(args.project, tiers, target_date))
    logger.info("Sync complete")


if __name__ == '__main__':
    main()
