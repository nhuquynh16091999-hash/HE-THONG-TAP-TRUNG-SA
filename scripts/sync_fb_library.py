#!/usr/bin/env python3
"""
Ads Spy Sync — Standalone script.

Usage:
    python scripts/sync_fb_library.py            # Default sync
    python scripts/sync_fb_library.py --test      # Test API connection
    python scripts/sync_fb_library.py --niche jewelry --market US  # Specific
"""
import os, sys, logging, argparse
from datetime import datetime

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
sys.path.insert(0, PROJECT_DIR)
os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = os.path.join(PROJECT_DIR, "bigquery_key.json")

from dotenv import load_dotenv
load_dotenv(os.path.join(PROJECT_DIR, ".env"))

# Logging
log_dir = os.path.join(PROJECT_DIR, "logs")
os.makedirs(log_dir, exist_ok=True)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(
            os.path.join(log_dir, f"ads_spy_{datetime.now().strftime('%Y%m%d_%H%M')}.log"),
            encoding="utf-8",
        ),
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger("ads_spy")


def main():
    parser = argparse.ArgumentParser(description="Ads Spy — FB Ad Library Sync")
    parser.add_argument("--test", action="store_true", help="Test connections only")
    parser.add_argument("--niche", type=str, help="Specific niche: jewelry, beauty, health")
    parser.add_argument("--market", type=str, help="Specific market: US, AU")
    args = parser.parse_args()

    from faos_brain.ads_spy.crawler import FBAdLibraryCrawler
    from faos_brain.ads_spy.scorer import score_all_ads
    from faos_brain.ads_spy import config as cfg

    log.info("═" * 50)
    log.info("ADS SPY — FB Ad Library Sync")
    log.info(f"Niches: {list(cfg.NICHES.keys())}")
    log.info(f"Markets: {cfg.MARKETS}")
    log.info("═" * 50)

    if args.test:
        import requests
        token = os.environ.get("META_ACCESS_TOKEN", "")
        log.info("Testing Meta API token...")
        r = requests.get(
            f"https://graph.facebook.com/{cfg.CRAWLER.api_version}/ads_archive",
            params={
                "search_terms": "necklace",
                "ad_reached_countries": '["US"]',
                "ad_type": "ALL",
                "ad_active_status": "ACTIVE",
                "fields": "id,page_name",
                "limit": 3,
                "access_token": token,
            },
            timeout=10,
        )
        data = r.json()
        if "error" in data:
            log.error(f"❌ API Error: {data['error'].get('message', '')}")
        else:
            count = len(data.get("data", []))
            log.info(f"✅ API OK — got {count} sample ads")
            for ad in data.get("data", [])[:3]:
                log.info(f"  • {ad.get('page_name', '?')} (ID: {ad.get('id', '?')})")
        return

    start = datetime.now()
    crawler = FBAdLibraryCrawler()
    counts = crawler.crawl_all()

    sync_date = start.strftime("%Y-%m-%d")
    scored = score_all_ads(sync_date=sync_date)

    elapsed = (datetime.now() - start).total_seconds()
    log.info(f"\n✅ DONE — {counts.get('ads', 0)} ads, {counts.get('creatives', 0)} creatives, {scored} scored | {elapsed:.0f}s")


if __name__ == "__main__":
    main()
