"""
Auto-scale Rules Engine — Suggest budget scaling based on rules.

Default rules evaluate campaign ROAS over N consecutive days,
then suggest scaling actions (increase/decrease budget).
All suggestions require marketer approval via Telegram.

Runs every 12 hours.
"""

from __future__ import annotations

import json
import logging
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional

log = logging.getLogger("faos.autoscale")

CHECK_INTERVAL_HOURS = 12
_timer: Optional[threading.Timer] = None

# ─── Default rules (can be extended via API) ───
DEFAULT_RULES = [
    {
        "id": "scale-up-hot",
        "name": "Scale Up Hot Campaigns",
        "condition": "ROAS >= 3.0 for 3 consecutive days",
        "roas_min": 3.0,
        "consecutive_days": 3,
        "action": "INCREASE",
        "change_pct": 20,
        "enabled": True,
    },
    {
        "id": "scale-up-winner",
        "name": "Scale Up Winners",
        "condition": "ROAS >= 4.0 for 2 consecutive days",
        "roas_min": 4.0,
        "consecutive_days": 2,
        "action": "INCREASE",
        "change_pct": 30,
        "enabled": True,
    },
    {
        "id": "scale-down-loser",
        "name": "Cut Losing Campaigns",
        "condition": "ROAS < 1.0 for 3 consecutive days AND spend > $20/day",
        "roas_max": 1.0,
        "consecutive_days": 3,
        "min_daily_spend": 20,
        "action": "DECREASE",
        "change_pct": -50,
        "enabled": True,
    },
    {
        "id": "kill-zero-roas",
        "name": "Kill Zero ROAS",
        "condition": "ROAS = 0 for 2 days AND spend > $15/day",
        "roas_max": 0.01,
        "consecutive_days": 2,
        "min_daily_spend": 15,
        "action": "PAUSE",
        "change_pct": -100,
        "enabled": True,
    },
]

# In-memory pending suggestions
_pending_suggestions: List[Dict[str, Any]] = []


def get_rules() -> List[Dict]:
    return DEFAULT_RULES.copy()


def get_pending() -> List[Dict]:
    return _pending_suggestions.copy()


def evaluate_rules(bq_client, project: str, dataset: str) -> List[Dict]:
    """Evaluate all rules against current campaign data."""
    suggestions = []

    for rule in DEFAULT_RULES:
        if not rule.get("enabled"):
            continue

        if rule.get("action") in ("INCREASE",):
            # Scale-up rules
            roas_min = rule.get("roas_min", 3.0)
            days = rule.get("consecutive_days", 3)

            q = f"""
            WITH daily AS (
                SELECT
                    CAST(campaign_id AS STRING) as campaign_id,
                    campaign_name,
                    ad_date,
                    ROUND(AVG(true_roas), 2) AS daily_roas,
                    ROUND(SUM(ad_spend)/25000, 2) AS daily_spend
                FROM `{project}.{dataset}.vw_true_roas`
                WHERE ad_date >= DATE_SUB(CURRENT_DATE(), INTERVAL {days+1} DAY)
                GROUP BY 1,2,3
                HAVING daily_spend >= 10
            ),
            streak AS (
                SELECT campaign_id, campaign_name,
                    COUNT(*) AS hot_days,
                    AVG(daily_roas) AS avg_roas,
                    AVG(daily_spend) AS avg_spend
                FROM daily
                WHERE daily_roas >= {roas_min}
                  AND ad_date >= DATE_SUB(CURRENT_DATE(), INTERVAL {days} DAY)
                GROUP BY 1,2
                HAVING hot_days >= {days}
            )
            SELECT * FROM streak ORDER BY avg_roas DESC LIMIT 5
            """
            try:
                rows = [dict(r) for r in bq_client.query(q).result()]
                for r in rows:
                    suggestions.append({
                        "rule_id": rule["id"],
                        "rule_name": rule["name"],
                        "campaign_id": r.get("campaign_id"),
                        "campaign_name": r.get("campaign_name"),
                        "avg_roas": round(r.get("avg_roas", 0), 2),
                        "avg_spend": round(r.get("avg_spend", 0), 2),
                        "action": rule["action"],
                        "change_pct": rule["change_pct"],
                        "status": "pending",
                    })
            except Exception as e:
                log.error(f"Rule {rule['id']} eval failed: {e}")

        elif rule.get("action") in ("DECREASE", "PAUSE"):
            # Scale-down rules
            roas_max = rule.get("roas_max", 1.0)
            days = rule.get("consecutive_days", 3)
            min_spend = rule.get("min_daily_spend", 15)

            q = f"""
            WITH daily AS (
                SELECT
                    CAST(campaign_id AS STRING) as campaign_id,
                    campaign_name,
                    ad_date,
                    ROUND(AVG(true_roas), 2) AS daily_roas,
                    ROUND(SUM(ad_spend)/25000, 2) AS daily_spend
                FROM `{project}.{dataset}.vw_true_roas`
                WHERE ad_date >= DATE_SUB(CURRENT_DATE(), INTERVAL {days+1} DAY)
                GROUP BY 1,2,3
                HAVING daily_spend >= {min_spend}
            ),
            streak AS (
                SELECT campaign_id, campaign_name,
                    COUNT(*) AS bad_days,
                    AVG(daily_roas) AS avg_roas,
                    AVG(daily_spend) AS avg_spend
                FROM daily
                WHERE daily_roas <= {roas_max}
                  AND ad_date >= DATE_SUB(CURRENT_DATE(), INTERVAL {days} DAY)
                GROUP BY 1,2
                HAVING bad_days >= {days}
            )
            SELECT * FROM streak ORDER BY avg_spend DESC LIMIT 5
            """
            try:
                rows = [dict(r) for r in bq_client.query(q).result()]
                for r in rows:
                    suggestions.append({
                        "rule_id": rule["id"],
                        "rule_name": rule["name"],
                        "campaign_id": r.get("campaign_id"),
                        "campaign_name": r.get("campaign_name"),
                        "avg_roas": round(r.get("avg_roas", 0), 2),
                        "avg_spend": round(r.get("avg_spend", 0), 2),
                        "action": rule["action"],
                        "change_pct": rule["change_pct"],
                        "status": "pending",
                    })
            except Exception as e:
                log.error(f"Rule {rule['id']} eval failed: {e}")

    return suggestions


async def send_autoscale_alert(bot_token: str, chat_id: str, suggestions: List[Dict]) -> bool:
    """Send Telegram alert with auto-scale suggestions."""
    import httpx

    increases = [s for s in suggestions if s["action"] == "INCREASE"]
    decreases = [s for s in suggestions if s["action"] in ("DECREASE", "PAUSE")]

    lines = [
        f"<b>Auto-Scale Suggestions</b>",
        f"{len(increases)} scale-up + {len(decreases)} scale-down",
        "--------------------",
    ]

    if increases:
        lines.append("<b>Scale Up:</b>")
        for s in increases[:3]:
            name = (s.get("campaign_name") or "?")[:30]
            lines.append(f"  +{s['change_pct']}% {name} (ROAS {s['avg_roas']}x)")

    if decreases:
        lines.append("")
        lines.append("<b>Scale Down/Pause:</b>")
        for s in decreases[:3]:
            name = (s.get("campaign_name") or "?")[:30]
            lines.append(f"  {s['change_pct']}% {name} (ROAS {s['avg_roas']}x, ${s['avg_spend']}/d)")

    lines.extend(["", "--------------------", "<i>Review and approve in dashboard</i>"])

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                f"https://api.telegram.org/bot{bot_token}/sendMessage",
                json={"chat_id": chat_id, "text": "\n".join(lines), "parse_mode": "HTML"},
            )
            resp.raise_for_status()
            return True
    except Exception as e:
        log.error(f"Autoscale alert failed: {e}")
        return False


def _check_and_alert():
    import asyncio
    global _pending_suggestions
    try:
        from faos_brain.config import settings
        from google.cloud import bigquery

        bq = bigquery.Client(project=settings.gcp_project_id)
        suggestions = evaluate_rules(bq, settings.gcp_project_id, settings.bq_dataset)

        if suggestions:
            _pending_suggestions = suggestions
            log.info(f"Auto-scale: {len(suggestions)} suggestions generated")
            token = settings.telegram_bot_token
            chat_id = settings.telegram_chat_id
            if token and chat_id:
                asyncio.run(send_autoscale_alert(token, chat_id, suggestions))
        else:
            log.info("Auto-scale: no suggestions")
    except Exception as e:
        log.error(f"Autoscale check failed: {e}")
    _schedule_next()


def _schedule_next():
    global _timer
    _timer = threading.Timer(CHECK_INTERVAL_HOURS * 3600, _check_and_alert)
    _timer.daemon = True
    _timer.start()


def start_autoscale():
    log.info(f"Starting Auto-scale Engine (every {CHECK_INTERVAL_HOURS}h)")
    global _timer
    _timer = threading.Timer(300, _check_and_alert)  # first check after 5 min
    _timer.daemon = True
    _timer.start()
    return True


def stop_autoscale():
    global _timer
    if _timer:
        _timer.cancel()
        _timer = None
