"""
Creative Fatigue API — Detect and manage fatigued ad creatives.

Endpoints:
  GET /api/creative-fatigue         — list fatigued ads
  POST /api/creative-fatigue/check  — trigger immediate check
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, List

from fastapi import APIRouter
from pydantic import BaseModel

log = logging.getLogger("faos.api.creative")
router = APIRouter(prefix="/api/creative-fatigue", tags=["creative-fatigue"])


class FatigueResponse(BaseModel):
    count: int
    critical: int
    warning: int
    ads: List[Dict[str, Any]]


@router.get("", response_model=FatigueResponse)
async def list_fatigued_ads():
    """List all ads showing fatigue signals."""
    from google.cloud import bigquery
    from faos_brain.config import settings

    bq = bigquery.Client(project=settings.gcp_project_id)
    q = f"""
    SELECT
        ad_id, ad_name, campaign_name, market,
        fatigue_level, fatigue_score,
        ROUND(ctr_recent, 4) as ctr_recent,
        ROUND(ctr_baseline, 4) as ctr_baseline,
        ctr_change_pct,
        ROUND(cpm_recent, 2) as cpm_recent,
        ROUND(cpm_baseline, 2) as cpm_baseline,
        cpm_change_pct,
        frequency_recent, frequency_baseline,
        spend_3d_usd, spend_7d_usd,
        active_days, first_date, last_date
    FROM `{settings.gcp_project_id}.{settings.bq_dataset}.vw_creative_fatigue_v2`
    ORDER BY fatigue_score DESC
    LIMIT 30
    """
    try:
        rows = list(bq.query(q).result())
        ads = []
        for r in rows:
            d = dict(r)
            for k in ("first_date", "last_date"):
                if d.get(k):
                    d[k] = d[k].isoformat()
            ads.append(d)
    except Exception as e:
        log.error(f"Query failed: {e}")
        ads = []

    critical = sum(1 for a in ads if a.get("fatigue_level") == "CRITICAL")
    warning = sum(1 for a in ads if a.get("fatigue_level") == "WARNING")

    return FatigueResponse(
        count=len(ads),
        critical=critical,
        warning=warning,
        ads=ads,
    )


@router.post("/check")
async def trigger_check(dry_run: bool = True):
    """Trigger immediate fatigue check. Set dry_run=false to send Telegram alert."""
    from google.cloud import bigquery
    from faos_brain.config import settings
    from faos_brain.services.creative_fatigue import fetch_fatigued_ads, send_fatigue_alert

    bq = bigquery.Client(project=settings.gcp_project_id)
    fatigued = fetch_fatigued_ads(bq, settings.gcp_project_id, settings.bq_dataset)

    sent = False
    if fatigued and not dry_run:
        token = settings.telegram_bot_token
        chat_id = settings.telegram_chat_id
        if token and chat_id:
            sent = await send_fatigue_alert(token, chat_id, fatigued)

    return {
        "fatigued_count": len(fatigued),
        "critical": sum(1 for a in fatigued if a.get("fatigue_level") == "CRITICAL"),
        "warning": sum(1 for a in fatigued if a.get("fatigue_level") == "WARNING"),
        "dry_run": dry_run,
        "telegram_sent": sent,
        "top_3": [
            {
                "ad_name": (a.get("ad_name") or "N/A")[:40],
                "fatigue_score": a.get("fatigue_score"),
                "fatigue_level": a.get("fatigue_level"),
            }
            for a in fatigued[:3]
        ],
    }
