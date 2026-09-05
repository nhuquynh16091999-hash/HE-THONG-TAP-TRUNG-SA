"""
Briefing API — FastAPI routes to trigger and test morning briefing.

Endpoints:
    GET  /api/briefing/status         — Scheduler status
    POST /api/briefing/send-test      — Send test briefing now (dry_run optional)
    GET  /api/briefing/preview        — Preview message without sending
    POST /api/briefing/start          — Start scheduler
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

log = logging.getLogger("faos.api.briefing")
router = APIRouter(prefix="/api/briefing", tags=["Morning Briefing"])


@router.get("/status")
async def briefing_status():
    """Get briefing scheduler status."""
    from faos_brain.services.morning_briefing import (
        _scheduler, BRIEFING_ENABLED, BRIEFING_HOUR_UTC
    )
    import pytz
    from datetime import datetime

    utc_time = f"{BRIEFING_HOUR_UTC:02d}:00 UTC"
    ict_hour = (BRIEFING_HOUR_UTC + 7) % 24
    ict_time = f"{ict_hour:02d}:00 ICT"

    return {
        "enabled": BRIEFING_ENABLED,
        "schedule": f"Daily at {utc_time} = {ict_time}",
        "scheduler_running": bool(_scheduler and _scheduler.running),
    }


@router.post("/send-test")
async def send_test_briefing(
    dry_run: bool = Query(True, description="If true, logs message without sending to Telegram"),
    project_id: str = Query("AUUS1"),
):
    """Send (or preview) the morning briefing right now."""
    try:
        from faos_brain.services.morning_briefing import generate_and_send
        result = await generate_and_send(project_id=project_id, dry_run=dry_run)
        return {"status": "ok", "dry_run": dry_run, "result": result}
    except Exception as e:
        log.error(f"Test briefing failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/preview")
async def preview_briefing(project_id: str = Query("AUUS1")):
    """Get full preview of today's briefing message as text."""
    try:
        from faos_brain.services.morning_briefing import (
            fetch_yesterday_pnl, fetch_best_campaign, fetch_kill_list,
            fetch_trending_spy, fetch_pending_orders, build_briefing_message
        )
        from faos_brain.config import settings
        from google.cloud import bigquery
        from datetime import datetime, timedelta, timezone

        bq = bigquery.Client(project=settings.gcp_project_id)
        proj = settings.gcp_project_id
        dataset = settings.bq_dataset
        yesterday = (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%d/%m/%Y")

        pnl = fetch_yesterday_pnl(bq, proj, dataset)
        best_camp = fetch_best_campaign(bq, proj, dataset)
        kill_list = fetch_kill_list(bq, proj, dataset)
        trending_spy = fetch_trending_spy(bq, proj, dataset)
        pending_orders = fetch_pending_orders(bq, proj, dataset)

        message = build_briefing_message(
            pnl=pnl,
            best_camp=best_camp,
            kill_list=kill_list,
            trending_spy=trending_spy,
            pending_orders=pending_orders,
            date_str=yesterday,
        )

        return {
            "message": message,
            "pnl": pnl,
            "best_campaign": best_camp,
            "kill_list": kill_list,
            "trending_spy": trending_spy,
            "pending_orders": pending_orders,
        }
    except Exception as e:
        log.error(f"Preview failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/start")
async def start_scheduler(project_id: str = Query("AUUS1")):
    """Start the daily briefing scheduler."""
    from faos_brain.services.morning_briefing import start_briefing_scheduler
    started = start_briefing_scheduler(project_id=project_id)
    return {"started": started, "message": "Scheduler started" if started else "Already running or disabled"}
