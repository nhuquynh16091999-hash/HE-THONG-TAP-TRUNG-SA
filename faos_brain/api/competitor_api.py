"""
Competitor Alert API — Monitor competitor ads.

Endpoints:
  GET /api/competitors/new-ads     — new hot ads in last 24h
  POST /api/competitors/check      — trigger immediate check
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List

from fastapi import APIRouter

log = logging.getLogger("faos.api.competitor")
router = APIRouter(prefix="/api/competitors", tags=["competitors"])


@router.get("/new-ads")
async def list_new_ads(market: str = "ALL", min_score: int = 300):
    """List new competitor ads discovered recently."""
    from google.cloud import bigquery
    from faos_brain.config import settings

    bq = bigquery.Client(project=settings.gcp_project_id)

    market_filter = f"AND market = '{market}'" if market != "ALL" else ""

    q = f"""
    SELECT
        page_name, headline, niche, market,
        CAST(hot_score AS INT64) AS hot_score,
        creative_type, duration_days,
        likes, comments, shares,
        ad_url, sync_date
    FROM `{settings.gcp_project_id}.{settings.bq_dataset}.fb_library_ads`
    WHERE sync_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 2 DAY)
      AND is_active = TRUE
      AND hot_score >= {min_score}
      {market_filter}
    ORDER BY hot_score DESC
    LIMIT 20
    """
    try:
        rows = list(bq.query(q).result())
        ads = []
        for r in rows:
            d = dict(r)
            if d.get("sync_date"):
                d["sync_date"] = d["sync_date"].isoformat()
            ads.append(d)
    except Exception as e:
        log.error(f"Query failed: {e}")
        ads = []

    return {"count": len(ads), "ads": ads}


@router.post("/check")
async def trigger_check(dry_run: bool = True):
    """Trigger immediate competitor check."""
    from google.cloud import bigquery
    from faos_brain.config import settings
    from faos_brain.services.competitor_watcher import fetch_new_competitor_ads, send_competitor_alert

    bq = bigquery.Client(project=settings.gcp_project_id)
    new_ads = fetch_new_competitor_ads(bq, settings.gcp_project_id, settings.bq_dataset)

    sent = False
    if new_ads and not dry_run:
        token = settings.telegram_bot_token
        chat_id = settings.telegram_chat_id
        if token and chat_id:
            sent = await send_competitor_alert(token, chat_id, new_ads)

    return {
        "new_ads_count": len(new_ads),
        "dry_run": dry_run,
        "telegram_sent": sent,
        "top_3": [{"page": a.get("page_name"), "score": a.get("hot_score")} for a in new_ads[:3]],
    }
