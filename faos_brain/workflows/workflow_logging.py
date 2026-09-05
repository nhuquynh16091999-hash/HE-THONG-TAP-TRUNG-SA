"""
Workflow Logging — BQ logging, SSE events, emergency alerts.

Split from daily_analysis.py for maintainability.
Contains:
    - log_run_start(): BQ agent_run_log insert (start)
    - log_run_end(): BQ agent_run_log insert (end)
    - emit_sse(): SSE event for Live Feed dashboard
    - send_emergency_alert(): Telegram + Discord emergency alerts
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import httpx

from faos_brain.config import settings

log = logging.getLogger("faos.workflow")


async def log_run_start(workflow) -> None:
    """Log workflow start to BQ agent_run_log table."""
    log.info(
        "[%s] ═══ WORKFLOW START ═══ project=%s date=%s dry_run=%s",
        workflow.run_id, workflow.project_id, workflow.run_date, workflow.dry_run,
    )
    try:
        bq = workflow._get_bq_client()
        table_id = f"{settings.gcp_project_id}.{settings.bq_dataset}.agent_run_log"

        row = {
            "run_id": workflow.run_id,
            "agent": "workflow",
            "project_id": workflow.project_id,
            "run_date": workflow.run_date.isoformat(),
            "run_type": "full_daily",
            "status": "STARTED",
            "dry_run": workflow.dry_run,
            "started_at": (
                workflow.started_at.isoformat()
                if workflow.started_at
                else datetime.now(timezone.utc).isoformat()
            ),
        }

        errors = bq.insert_rows_json(table_id, [row])
        if errors:
            log.warning("[%s] BQ agent_run_log start insert errors: %s", workflow.run_id, errors)
    except Exception as exc:
        log.warning("[%s] Failed to log run start to BQ: %s", workflow.run_id, exc)


async def log_run_end(
    workflow,
    status: str,
    error: Optional[str] = None,
) -> None:
    """Log workflow completion/failure to BQ agent_run_log."""
    duration = None
    if workflow.started_at:
        duration = (datetime.now(timezone.utc) - workflow.started_at).total_seconds()

    log.info(
        "[%s] Run end: status=%s, duration=%.1fs",
        workflow.run_id, status, duration or 0,
    )

    try:
        bq = workflow._get_bq_client()
        table_id = f"{settings.gcp_project_id}.{settings.bq_dataset}.agent_run_log"

        row = {
            "run_id": workflow.run_id,
            "agent": "workflow",
            "project_id": workflow.project_id,
            "run_date": workflow.run_date.isoformat(),
            "run_type": "full_daily",
            "status": status,
            "dry_run": workflow.dry_run,
            "started_at": workflow.started_at.isoformat() if workflow.started_at else None,
            "completed_at": datetime.now(timezone.utc).isoformat(),
            "duration_seconds": round(duration, 1) if duration else None,
            "error": error[:1000] if error else None,
        }

        errors = bq.insert_rows_json(table_id, [row])
        if errors:
            log.warning("[%s] BQ agent_run_log end insert errors: %s", workflow.run_id, errors)
    except Exception as exc:
        log.warning("[%s] Failed to log run end to BQ: %s", workflow.run_id, exc)


async def emit_sse(workflow, event: str, data: Dict[str, Any]) -> None:
    """
    Emit SSE event for Live Feed dashboard.

    Currently logs to console. When Redis is available,
    publishes to Redis Pub/Sub channel for SSE streaming.

    Args:
        workflow: ForcedWorkflow instance.
        event: Event name (e.g., "workflow_start", "analyst_done").
        data: Event payload dict.
    """
    payload = {
        "event": event,
        "run_id": workflow.run_id,
        "project_id": workflow.project_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        **data,
    }

    # Log to console (always)
    log.info("[%s] SSE: %s → %s", workflow.run_id, event, json.dumps(payload, default=str))

    # Redis Pub/Sub (when available)
    try:
        import redis as redis_lib
        r = redis_lib.from_url(settings.redis_url)
        channel = f"faos:sse:{workflow.project_id}"
        r.publish(channel, json.dumps(payload, default=str))
        r.close()
    except Exception:
        # Non-critical — Redis may not be running in dev
        pass


async def send_emergency_alert(workflow, error_msg: str) -> None:
    """
    Send emergency alert to Telegram + Discord.

    Fired when data gates fail or a critical workflow step errors.
    """
    alert = (
        f"🚨 EMERGENCY HALT — {workflow.project_id}\n\n"
        f"Run ID: {workflow.run_id}\n"
        f"Date: {workflow.run_date.isoformat()}\n\n"
        f"❌ {error_msg[:800]}\n\n"
        f"⚠️ ALL AI EXECUTION BLOCKED until issue is resolved.\n"
        f"🔧 Check data pipeline and manually restart."
    )

    log.error("[%s] EMERGENCY ALERT:\n%s", workflow.run_id, alert)

    if workflow.dry_run:
        log.warning("[%s] DRY RUN — emergency alert NOT sent externally.", workflow.run_id)
        return

    # Telegram
    if settings.telegram_bot_token and settings.telegram_chat_id:
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                url = f"https://api.telegram.org/bot{settings.telegram_bot_token}/sendMessage"
                await client.post(url, json={
                    "chat_id": settings.telegram_chat_id,
                    "text": alert,
                })
                log.info("[%s] Telegram emergency alert sent.", workflow.run_id)
        except Exception as exc:
            log.error("[%s] Telegram alert failed: %s", workflow.run_id, exc)

    # Discord
    if settings.discord_webhook_alert:
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                await client.post(
                    settings.discord_webhook_alert,
                    json={"content": alert},
                )
                log.info("[%s] Discord emergency alert sent.", workflow.run_id)
        except Exception as exc:
            log.error("[%s] Discord alert failed: %s", workflow.run_id, exc)
