"""
Creative Fatigue Detector — Background service.

Checks ad creatives for fatigue signals (CTR dropping, CPM rising, frequency > 3)
and sends Telegram alerts when creatives need replacement.

Runs every 6 hours via threading.Timer.
"""

from __future__ import annotations

import logging
import threading
from typing import Any, Dict, List, Optional

log = logging.getLogger("faos.creative_fatigue")

# ─── Config ───
CHECK_INTERVAL_HOURS = 6
_timer: Optional[threading.Timer] = None


# ─── BQ helpers ───
def _bq_query(bq_client, sql: str) -> List[Dict[str, Any]]:
    try:
        rows = bq_client.query(sql).result()
        return [dict(r) for r in rows]
    except Exception as e:
        log.error(f"BQ query failed: {e}")
        return []


def fetch_fatigued_ads(bq_client, project: str, dataset: str) -> List[Dict]:
    """Fetch all ads with fatigue signals."""
    q = f"""
    SELECT *
    FROM `{project}.{dataset}.vw_creative_fatigue_v2`
    ORDER BY fatigue_score DESC
    LIMIT 20
    """
    return _bq_query(bq_client, q)


# ─── Telegram alert ───
async def send_fatigue_alert(
    bot_token: str, chat_id: str, fatigued_ads: List[Dict]
) -> bool:
    """Send Telegram alert about fatigued creatives."""
    import httpx

    critical = [a for a in fatigued_ads if a.get("fatigue_level") == "CRITICAL"]
    warning = [a for a in fatigued_ads if a.get("fatigue_level") == "WARNING"]

    lines = [
        f"<b>Creative Fatigue Alert</b>",
        f"Found {len(critical)} CRITICAL + {len(warning)} WARNING ads",
        "--------------------",
    ]

    for ad in fatigued_ads[:5]:
        name = (ad.get("ad_name") or "N/A")[:30]
        level = ad.get("fatigue_level", "?")
        score = ad.get("fatigue_score", 0)
        ctr_chg = ad.get("ctr_change_pct", 0)
        cpm_chg = ad.get("cpm_change_pct", 0)
        freq = ad.get("frequency_recent", 0)
        spend = ad.get("spend_3d_usd", 0)

        icon = "🔴" if level == "CRITICAL" else "🟡"
        lines.append(f"{icon} <b>{name}</b> [{ad.get('market', '')}]")
        lines.append(f"   Score: {score} | CTR: {ctr_chg:+.1f}% | CPM: {cpm_chg:+.1f}%")
        lines.append(f"   Freq: {freq:.1f} | 3d Spend: ${spend:.0f}")
        lines.append("")

    lines.extend([
        "--------------------",
        "<i>Action: Replace creative or pause ad</i>",
    ])

    message = "\n".join(lines)

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                f"https://api.telegram.org/bot{bot_token}/sendMessage",
                json={"chat_id": chat_id, "text": message, "parse_mode": "HTML"},
            )
            resp.raise_for_status()
            return True
    except Exception as e:
        log.error(f"Fatigue alert send failed: {e}")
        return False


# ─── Background checker ───
def _check_and_alert():
    """Background check for creative fatigue."""
    import asyncio

    try:
        from faos_brain.config import settings
        from google.cloud import bigquery

        bq = bigquery.Client(project=settings.gcp_project_id)
        fatigued = fetch_fatigued_ads(bq, settings.gcp_project_id, settings.bq_dataset)

        if fatigued:
            log.info(f"Found {len(fatigued)} fatigued ads, sending alert")
            token = settings.telegram_bot_token
            chat_id = settings.telegram_chat_id
            if token and chat_id:
                asyncio.run(send_fatigue_alert(token, chat_id, fatigued))
        else:
            log.info("No fatigued ads detected")

    except Exception as e:
        log.error(f"Creative fatigue check failed: {e}")

    # Re-schedule
    _schedule_next()


def _schedule_next():
    global _timer
    interval = CHECK_INTERVAL_HOURS * 3600
    _timer = threading.Timer(interval, _check_and_alert)
    _timer.daemon = True
    _timer.start()


def start_fatigue_watcher():
    """Start the creative fatigue background watcher."""
    log.info(f"Starting Creative Fatigue watcher (every {CHECK_INTERVAL_HOURS}h)")
    # Run first check after 2 minutes (let server boot)
    global _timer
    _timer = threading.Timer(120, _check_and_alert)
    _timer.daemon = True
    _timer.start()
    return True


def stop_fatigue_watcher():
    global _timer
    if _timer:
        _timer.cancel()
        _timer = None
    log.info("Creative Fatigue watcher stopped")
