"""
Competitor Alert — Background watcher for new competitor ads.

Monitors fb_library_ads for newly discovered ads and sends Telegram alerts.
Runs every 4 hours via threading.Timer.
"""

from __future__ import annotations

import logging
import threading
from typing import Any, Dict, List, Optional

log = logging.getLogger("faos.competitor_watcher")

CHECK_INTERVAL_HOURS = 4
_timer: Optional[threading.Timer] = None


def _bq_query(bq_client, sql: str) -> List[Dict[str, Any]]:
    try:
        return [dict(r) for r in bq_client.query(sql).result()]
    except Exception as e:
        log.error(f"BQ query failed: {e}")
        return []


def fetch_new_competitor_ads(bq_client, project: str, dataset: str) -> List[Dict]:
    """Fetch competitor ads discovered in the last 24 hours."""
    q = f"""
    SELECT
        page_name,
        headline,
        niche,
        market,
        CAST(hot_score AS INT64) AS hot_score,
        creative_type,
        duration_days,
        likes, comments, shares,
        ad_url,
        sync_date
    FROM `{project}.{dataset}.fb_library_ads`
    WHERE sync_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY)
      AND is_active = TRUE
      AND hot_score >= 500
    ORDER BY hot_score DESC
    LIMIT 10
    """
    return _bq_query(bq_client, q)


async def send_competitor_alert(
    bot_token: str, chat_id: str, new_ads: List[Dict]
) -> bool:
    """Send Telegram alert about new competitor ads."""
    import httpx

    lines = [
        f"<b>New Competitor Ads Alert</b>",
        f"Found {len(new_ads)} hot ads in last 24h",
        "--------------------",
    ]

    for ad in new_ads[:5]:
        page = ad.get("page_name", "?")
        headline = (ad.get("headline") or "No headline")[:50]
        score = ad.get("hot_score", 0)
        market = ad.get("market", "?")
        creative = ad.get("creative_type", "?")
        likes = ad.get("likes", 0)

        lines.append(f"<b>{page}</b> [{market}] Score: {score}")
        lines.append(f"   {headline}")
        lines.append(f"   Type: {creative} | Likes: {likes}")
        lines.append("")

    lines.extend([
        "--------------------",
        "<i>Spy and clone winning creatives!</i>",
    ])

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                f"https://api.telegram.org/bot{bot_token}/sendMessage",
                json={"chat_id": chat_id, "text": "\n".join(lines), "parse_mode": "HTML"},
            )
            resp.raise_for_status()
            return True
    except Exception as e:
        log.error(f"Competitor alert failed: {e}")
        return False


def _check_and_alert():
    import asyncio
    try:
        from faos_brain.config import settings
        from google.cloud import bigquery

        bq = bigquery.Client(project=settings.gcp_project_id)
        new_ads = fetch_new_competitor_ads(bq, settings.gcp_project_id, settings.bq_dataset)

        if new_ads:
            log.info(f"Found {len(new_ads)} new competitor ads")
            token = settings.telegram_bot_token
            chat_id = settings.telegram_chat_id
            if token and chat_id:
                asyncio.run(send_competitor_alert(token, chat_id, new_ads))
        else:
            log.info("No new competitor ads")
    except Exception as e:
        log.error(f"Competitor check failed: {e}")
    _schedule_next()


def _schedule_next():
    global _timer
    _timer = threading.Timer(CHECK_INTERVAL_HOURS * 3600, _check_and_alert)
    _timer.daemon = True
    _timer.start()


def start_competitor_watcher():
    log.info(f"Starting Competitor Watcher (every {CHECK_INTERVAL_HOURS}h)")
    global _timer
    _timer = threading.Timer(180, _check_and_alert)
    _timer.daemon = True
    _timer.start()
    return True


def stop_competitor_watcher():
    global _timer
    if _timer:
        _timer.cancel()
        _timer = None
