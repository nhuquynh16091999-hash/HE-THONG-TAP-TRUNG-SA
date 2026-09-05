"""
Auto-scale Rules API — Manage scaling rules and approve suggestions.

Endpoints:
  GET /api/autoscale/rules      — list rules
  GET /api/autoscale/pending    — pending suggestions
  POST /api/autoscale/evaluate  — trigger evaluation
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List

from fastapi import APIRouter

log = logging.getLogger("faos.api.autoscale")
router = APIRouter(prefix="/api/autoscale", tags=["autoscale"])


@router.get("/rules")
async def list_rules():
    """List all auto-scale rules."""
    from faos_brain.services.autoscale_engine import get_rules
    rules = get_rules()
    return {"count": len(rules), "rules": rules}


@router.get("/pending")
async def list_pending():
    """List pending auto-scale suggestions."""
    from faos_brain.services.autoscale_engine import get_pending
    pending = get_pending()
    return {"count": len(pending), "suggestions": pending}


@router.post("/evaluate")
async def trigger_evaluation(dry_run: bool = True):
    """Trigger auto-scale rule evaluation now."""
    from google.cloud import bigquery
    from faos_brain.config import settings
    from faos_brain.services.autoscale_engine import evaluate_rules, send_autoscale_alert

    bq = bigquery.Client(project=settings.gcp_project_id)
    suggestions = evaluate_rules(bq, settings.gcp_project_id, settings.bq_dataset)

    sent = False
    if suggestions and not dry_run:
        token = settings.telegram_bot_token
        chat_id = settings.telegram_chat_id
        if token and chat_id:
            sent = await send_autoscale_alert(token, chat_id, suggestions)

    return {
        "suggestions_count": len(suggestions),
        "scale_up": sum(1 for s in suggestions if s["action"] == "INCREASE"),
        "scale_down": sum(1 for s in suggestions if s["action"] in ("DECREASE", "PAUSE")),
        "dry_run": dry_run,
        "telegram_sent": sent,
        "suggestions": suggestions[:5],
    }
