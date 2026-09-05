"""
Alert API — FastAPI routes for ROI alerts dashboard.

Endpoints:
    GET  /api/alerts/status          — Watcher status (running/stopped)
    GET  /api/alerts/history         — Alert history from BQ (last 7 days)
    POST /api/alerts/check-now       — Trigger immediate check
    POST /api/alerts/thresholds      — Update ROAS thresholds
    POST /api/alerts/action          — Handle Telegram callback (kill/pause/ignore)
    GET  /api/alerts/start           — Start watcher
    GET  /api/alerts/stop            — Stop watcher
"""
from __future__ import annotations

import logging
import os
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from faos_brain.services.roi_watcher import (
    check_and_alert,
    get_watcher_status,
    start_watcher,
    stop_watcher,
    DANGER_THRESHOLD,
    SCALE_THRESHOLD,
    MIN_SPEND_USD,
)

log = logging.getLogger("faos.api.alerts")
router = APIRouter(prefix="/api/alerts", tags=["ROI Alerts"])


# ─── Pydantic models ─────────────────────────────────────────────────────────

class ThresholdUpdate(BaseModel):
    danger_threshold: Optional[float] = None
    scale_threshold: Optional[float] = None
    min_spend_usd: Optional[float] = None


class TelegramCallback(BaseModel):
    """Callback from Telegram inline keyboard button press."""
    callback_query_id: str
    campaign_id: str
    action: str  # "kill" | "pause" | "details" | "ignore"
    alert_id: Optional[str] = None


# ─── Routes ──────────────────────────────────────────────────────────────────

@router.get("/status")
async def alert_status():
    """Get current watcher status and config."""
    return get_watcher_status()


@router.get("/start")
async def start_alert_watcher(project_id: str = Query("AUUS1")):
    """Start the background ROI watcher."""
    started = start_watcher(project_id=project_id)
    return {
        "started": started,
        "message": "Watcher started" if started else "Watcher already running",
        "status": get_watcher_status(),
    }


@router.get("/stop")
async def stop_alert_watcher():
    """Stop the background ROI watcher."""
    stop_watcher()
    return {"message": "Watcher stop requested", "status": get_watcher_status()}


@router.post("/check-now")
async def trigger_check(
    project_id: str = Query("AUUS1"),
    dry_run: bool = Query(False),
):
    """Trigger an immediate ROI check (does not wait for interval)."""
    try:
        alerts = await check_and_alert(project_id=project_id, dry_run=dry_run)
        return {
            "alerts_fired": len(alerts),
            "dry_run": dry_run,
            "alerts": alerts,
        }
    except Exception as e:
        log.error(f"Manual check failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/history")
async def alert_history(
    days: int = Query(7, description="Look-back days"),
    alert_type: Optional[str] = Query(None, description="Filter: danger | scale"),
    market: Optional[str] = Query(None),
    limit: int = Query(50),
):
    """Get alert history from BigQuery."""
    try:
        from google.cloud import bigquery
        from faos_brain.config import settings

        bq = bigquery.Client(project=settings.gcp_project_id)

        conditions = [f"DATE(created_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL {days} DAY)"]
        if alert_type:
            conditions.append(f"alert_type = '{alert_type}'")
        if market:
            conditions.append(f"market = '{market}'")
        where = " AND ".join(conditions)

        q = f"""
        SELECT
            alert_id, campaign_id, campaign_name, market, alert_type,
            roas, spend_usd, revenue_usd, telegram_sent, action_taken, created_at
        FROM `{settings.gcp_project_id}.{settings.bq_dataset}.roi_alerts`
        WHERE {where}
        ORDER BY created_at DESC
        LIMIT {limit}
        """
        rows = [dict(r) for r in bq.query(q)]
        return {"count": len(rows), "alerts": rows}

    except Exception as e:
        log.error(f"Alert history error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/thresholds")
async def update_thresholds(update: ThresholdUpdate):
    """
    Update ROI alert thresholds at runtime (writes to env vars).
    Note: persists for this process session only. Update .env for permanent change.
    """
    changed = {}
    if update.danger_threshold is not None:
        os.environ["ROI_DANGER_THRESHOLD"] = str(update.danger_threshold)
        changed["danger_threshold"] = update.danger_threshold
    if update.scale_threshold is not None:
        os.environ["ROI_SCALE_THRESHOLD"] = str(update.scale_threshold)
        changed["scale_threshold"] = update.scale_threshold
    if update.min_spend_usd is not None:
        os.environ["ROI_MIN_SPEND_USD"] = str(update.min_spend_usd)
        changed["min_spend_usd"] = update.min_spend_usd

    return {
        "message": "Thresholds updated (session only)",
        "changed": changed,
        "status": get_watcher_status(),
    }


@router.post("/action")
async def handle_alert_action(callback: TelegramCallback):
    """
    Handle action from Telegram inline keyboard.
    This endpoint receives callback from webhook handler.

    Actions:
      - kill: Immediately pause/kill campaign via Meta API
      - pause: Pause for 6 hours then re-check
      - details: Return campaign details
      - ignore: Mark as ignored, extend cooldown
    """
    from faos_brain.config import settings

    log.info(f"Alert action received: {callback.action} for {callback.campaign_id}")

    if callback.action == "kill":
        # Attempt to pause campaign via Meta API
        try:
            from faos_brain.meta_api import MetaAPIClient
            meta = MetaAPIClient()
            result = await meta.pause_campaign(callback.campaign_id)
            return {
                "status": "ok",
                "action": "kill",
                "campaign_id": callback.campaign_id,
                "meta_result": result,
            }
        except Exception as e:
            log.error(f"Meta API kill failed: {e}")
            return {"status": "error", "message": str(e), "action": "kill"}

    elif callback.action == "pause":
        return {
            "status": "ok",
            "action": "pause",
            "campaign_id": callback.campaign_id,
            "message": "Manual pause — please pause in Ads Manager. Auto-pause via Meta API requires ads_management permission.",
        }

    elif callback.action == "ignore":
        # The roi_watcher's _alert_sent_at cooldown already handles dedup
        return {
            "status": "ok",
            "action": "ignore",
            "campaign_id": callback.campaign_id,
            "message": "Alert ignored. Will re-alert after cooldown period.",
        }

    elif callback.action == "details":
        try:
            from google.cloud import bigquery
            bq = bigquery.Client(project=settings.gcp_project_id)
            q = f"""
            SELECT *
            FROM `{settings.gcp_project_id}.{settings.bq_dataset}.vw_campaign_daily`
            WHERE campaign_id = '{callback.campaign_id}'
              AND date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
            ORDER BY date DESC
            LIMIT 7
            """
            rows = [dict(r) for r in bq.query(q)]
            return {"status": "ok", "action": "details", "history": rows}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    return {"status": "error", "message": f"Unknown action: {callback.action}"}
