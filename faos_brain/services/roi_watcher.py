"""
ROI Real-time Alert Watcher — AUUS1

Monitors campaigns every N minutes and fires Telegram alerts when:
  - ROAS drops below danger threshold (default 1.5x)
  - ROAS exceeds scale threshold (default 4.0x) — scale opportunity

Alert includes inline keyboard so marketer can act from Telegram:
  [✅ Kill] [⏸ Pause 6h] [📊 Details] [🔕 Ignore]

Design:
  - Runs as background thread via asyncio + threading
  - Reads from BigQuery view vw_campaign_roas_today
  - Deduplicates: only alerts once per campaign per window
  - Logs all alerts to BQ table: roi_alerts
  - Can be triggered manually via /api/alerts/check-now
"""
from __future__ import annotations

import json
import logging
import os
import threading
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx

log = logging.getLogger("faos.roi_watcher")

# ─── Configuration (from env) ───────────────────────────────────────────────
CHECK_INTERVAL_SECONDS = int(os.environ.get("ROI_CHECK_INTERVAL_MINUTES", "30")) * 60
MIN_SPEND_USD = float(os.environ.get("ROI_MIN_SPEND_USD", "20"))
DANGER_THRESHOLD = float(os.environ.get("ROI_DANGER_THRESHOLD", "1.5"))
SCALE_THRESHOLD = float(os.environ.get("ROI_SCALE_THRESHOLD", "4.0"))
ALERT_ENABLED = os.environ.get("ROI_ALERT_ENABLED", "true").lower() == "true"

# Alert cooldown: don't re-alert same campaign within X seconds
ALERT_COOLDOWN_SECONDS = int(os.environ.get("ROI_ALERT_COOLDOWN_HOURS", "4")) * 3600

# ─── In-memory dedup cache ───────────────────────────────────────────────────
_alert_sent_at: Dict[str, float] = {}  # campaign_id → unix timestamp


def _cooldown_ok(campaign_id: str) -> bool:
    """Return True if we haven't alerted for this campaign within cooldown window."""
    last = _alert_sent_at.get(campaign_id, 0)
    return (time.time() - last) > ALERT_COOLDOWN_SECONDS


def _mark_alerted(campaign_id: str) -> None:
    _alert_sent_at[campaign_id] = time.time()


# ─── BigQuery query ──────────────────────────────────────────────────────────
ROAS_QUERY = """
SELECT
    c.campaign_id,
    c.campaign_name,
    c.market,
    SUM(c.spend_usd) as spend_usd,
    SUM(c.purchase_value_usd) as revenue_usd,
    SAFE_DIVIDE(SUM(c.purchase_value_usd), NULLIF(SUM(c.spend_usd), 0)) as roas
FROM `{project}.{dataset}.vw_campaign_daily` c
WHERE c.date = CURRENT_DATE()
  AND c.project_id = '{project_id}'
  AND SUM(c.spend_usd) OVER (PARTITION BY c.campaign_id) >= {min_spend}
GROUP BY 1, 2, 3
HAVING spend_usd >= {min_spend}
ORDER BY roas ASC
"""

# ─── Telegram alert helper ───────────────────────────────────────────────────

async def _send_telegram_alert(
    bot_token: str,
    chat_id: str,
    campaign: Dict[str, Any],
    alert_type: str,  # "danger" | "scale"
    alert_id: str,
) -> Optional[str]:
    """Send ROI alert with inline keyboard. Returns message_id."""
    campaign_id = campaign.get("campaign_id", "")
    campaign_name = campaign.get("campaign_name", "N/A")
    market = campaign.get("market", "—")
    spend = campaign.get("spend_usd", 0)
    revenue = campaign.get("revenue_usd", 0)
    roas = campaign.get("roas", 0)

    if alert_type == "danger":
        emoji = "⚠️"
        title = "LOW ROAS ALERT"
        verdict = f"ROAS {roas:.1f}x — đang burn tiền!"
        action_hint = "Nên xem lại hoặc kill campaign này."
    else:
        emoji = "🚀"
        title = "SCALE OPPORTUNITY"
        verdict = f"ROAS {roas:.1f}x — đang WIN mạnh!"
        action_hint = "Cân nhắc tăng budget ngay."

    message = (
        f"{emoji} *{title} — AUUS1*\n"
        f"━━━━━━━━━━━━━━━━━\n"
        f"📌 Campaign: `{campaign_name}`\n"
        f"🌍 Market: {market}\n"
        f"💸 Spend: ${spend:.0f} | Rev: ${revenue:.0f}\n"
        f"📈 ROAS: *{roas:.2f}x*\n"
        f"━━━━━━━━━━━━━━━━━\n"
        f"💡 {verdict}\n"
        f"🔖 {action_hint}\n\n"
        f"_Alert ID: {alert_id[:8]}_"
    )

    inline_keyboard = {
        "inline_keyboard": [
            [
                {"text": "🗑 Kill Now", "callback_data": f"roi_kill_{campaign_id}_{alert_id[:8]}"},
                {"text": "⏸ Pause 6h", "callback_data": f"roi_pause_{campaign_id}_{alert_id[:8]}"},
            ],
            [
                {"text": "📊 View Details", "callback_data": f"roi_details_{campaign_id}"},
                {"text": "🔕 Ignore", "callback_data": f"roi_ignore_{campaign_id}_{alert_id[:8]}"},
            ],
        ]
    }

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
            payload = {
                "chat_id": chat_id,
                "text": message,
                "parse_mode": "Markdown",
                "reply_markup": inline_keyboard,
            }
            resp = await client.post(url, json=payload)
            resp.raise_for_status()
            data = resp.json()
            msg_id = str(data.get("result", {}).get("message_id", ""))
            log.info(f"ROI alert sent (type={alert_type}, campaign={campaign_name}, msg_id={msg_id})")
            return msg_id
    except Exception as e:
        log.error(f"Telegram alert failed: {e}")
        return None


def _log_alert_to_bq(
    bq_client,
    project: str,
    dataset: str,
    alert: Dict[str, Any],
) -> None:
    """Log alert to BigQuery roi_alerts table."""
    try:
        table_id = f"{project}.{dataset}.roi_alerts"
        errors = bq_client.insert_rows_json(table_id, [alert])
        if errors:
            log.warning(f"BQ roi_alerts insert errors: {errors}")
    except Exception as e:
        log.warning(f"Failed to log alert to BQ: {e}")


# ─── Main check function ─────────────────────────────────────────────────────

async def check_and_alert(
    project_id: str = "AUUS1",
    dry_run: bool = False,
) -> List[Dict]:
    """
    Query today's campaign ROAS and send alerts for outliers.
    Returns list of alert dicts that were triggered.
    """
    from faos_brain.config import settings

    if not ALERT_ENABLED and not dry_run:
        log.info("ROI alerts disabled (ROI_ALERT_ENABLED=false)")
        return []

    alerts_fired = []

    try:
        from google.cloud import bigquery
        bq = bigquery.Client(project=settings.gcp_project_id)

        # vw_true_roas: ad_spend in VND, attributed_revenue in VND, true_roas available
        # Approximate USD: divide by dim_exchange_rates or use fixed 25000 VND/USD
        query = f"""
        SELECT
            CAST(campaign_id AS STRING) as campaign_id,
            campaign_name,
            CASE
                WHEN UPPER(campaign_name) LIKE '%_AU_%' THEN 'AU'
                WHEN UPPER(campaign_name) LIKE '%_US_%' THEN 'US'
                ELSE 'AU'
            END as market,
            ROUND(SUM(ad_spend) / 25000, 2) as spend_usd,
            ROUND(SUM(attributed_revenue) / 25000, 2) as revenue_usd,
            ROUND(AVG(true_roas), 3) as roas
        FROM `{settings.gcp_project_id}.{settings.bq_dataset}.vw_true_roas`
        WHERE ad_date = CURRENT_DATE()
        GROUP BY 1, 2, 3
        HAVING spend_usd >= {MIN_SPEND_USD}
        ORDER BY roas ASC
        """

        campaigns = [dict(row) for row in bq.query(query)]
        log.info(f"ROI check: {len(campaigns)} campaigns with spend >= ${MIN_SPEND_USD}")

        for camp in campaigns:
            campaign_id = camp.get("campaign_id", "")
            roas = camp.get("roas") or 0

            # Determine alert type
            if roas < DANGER_THRESHOLD:
                alert_type = "danger"
            elif roas >= SCALE_THRESHOLD:
                alert_type = "scale"
            else:
                continue  # Normal range — no alert

            # Check cooldown
            if not _cooldown_ok(campaign_id):
                log.debug(f"Skipping {campaign_id} — still in cooldown")
                continue

            alert_id = f"roi_{uuid.uuid4().hex[:12]}"
            alert_record = {
                "alert_id": alert_id,
                "campaign_id": campaign_id,
                "campaign_name": camp.get("campaign_name", ""),
                "market": camp.get("market", ""),
                "alert_type": alert_type,
                "roas": roas,
                "spend_usd": camp.get("spend_usd", 0),
                "revenue_usd": camp.get("revenue_usd", 0),
                "danger_threshold": DANGER_THRESHOLD,
                "scale_threshold": SCALE_THRESHOLD,
                "telegram_sent": False,
                "action_taken": None,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }

            if not dry_run:
                msg_id = await _send_telegram_alert(
                    bot_token=settings.telegram_bot_token,
                    chat_id=settings.telegram_chat_id,
                    campaign=camp,
                    alert_type=alert_type,
                    alert_id=alert_id,
                )
                alert_record["telegram_sent"] = bool(msg_id)
                alert_record["telegram_msg_id"] = msg_id

                _mark_alerted(campaign_id)
                _log_alert_to_bq(bq, settings.gcp_project_id, settings.bq_dataset, alert_record)
            else:
                log.info(f"[DRY RUN] Would alert: {alert_type} for {camp.get('campaign_name')} ROAS={roas:.2f}x")

            alerts_fired.append(alert_record)

    except Exception as e:
        log.error(f"ROI check failed: {e}")

    return alerts_fired


# ─── Background scheduler ────────────────────────────────────────────────────

_watcher_thread: Optional[threading.Thread] = None
_watcher_running = False


def _watcher_loop(project_id: str):
    """Run check_and_alert in a loop. Runs in a daemon thread."""
    import asyncio
    global _watcher_running
    log.info(f"ROI Watcher started: check every {CHECK_INTERVAL_SECONDS//60}min, project={project_id}")

    while _watcher_running:
        try:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            alerts = loop.run_until_complete(check_and_alert(project_id=project_id))
            if alerts:
                log.info(f"ROI check: {len(alerts)} alert(s) fired")
            loop.close()
        except Exception as e:
            log.error(f"ROI watcher loop error: {e}")
        time.sleep(CHECK_INTERVAL_SECONDS)

    log.info("ROI Watcher stopped.")


def start_watcher(project_id: str = "AUUS1") -> bool:
    """Start the background ROI watcher thread. Returns True if started."""
    global _watcher_thread, _watcher_running
    if _watcher_running:
        log.info("ROI Watcher already running.")
        return False

    _watcher_running = True
    _watcher_thread = threading.Thread(
        target=_watcher_loop,
        args=(project_id,),
        daemon=True,
        name="roi-watcher",
    )
    _watcher_thread.start()
    return True


def stop_watcher() -> None:
    """Signal the watcher to stop."""
    global _watcher_running
    _watcher_running = False
    log.info("ROI Watcher stop requested.")


def get_watcher_status() -> Dict:
    return {
        "running": _watcher_running,
        "check_interval_minutes": CHECK_INTERVAL_SECONDS // 60,
        "danger_threshold": DANGER_THRESHOLD,
        "scale_threshold": SCALE_THRESHOLD,
        "min_spend_usd": MIN_SPEND_USD,
        "alert_enabled": ALERT_ENABLED,
        "cooldown_hours": ALERT_COOLDOWN_SECONDS // 3600,
        "cached_campaign_cooldowns": len(_alert_sent_at),
    }
