"""
Morning Briefing Service — AUUS1

Generates and sends a daily morning briefing to Telegram at 8:00 AM ICT (1:00 AM UTC).

Briefing includes:
  📊 Yesterday P&L: Revenue, Spend, ROAS, Orders
  🏆 Best performer: top campaign + ROAS
  🔴 Kill list: campaigns below threshold
  🆕 Trending competitor: top 3 hot ads from spy
  📦 Orders to fulfill: pending AU/US

Schedule: runs via APScheduler (or can be called manually)
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import httpx

log = logging.getLogger("faos.briefing")

BRIEFING_ENABLED = os.environ.get("BRIEFING_ENABLED", "true").lower() == "true"
BRIEFING_HOUR_UTC = int(os.environ.get("BRIEFING_HOUR_UTC", "1"))  # 1am UTC = 8am ICT

# ─── Data fetchers ────────────────────────────────────────────────────────────

def _bq_query(bq_client, query: str) -> List[Dict]:
    """Run a BQ query and return list of dicts."""
    try:
        return [dict(row) for row in bq_client.query(query)]
    except Exception as e:
        log.warning(f"BQ query failed: {e}")
        return []


def fetch_yesterday_pnl(bq_client, project: str, dataset: str) -> Dict[str, Any]:
    """Fetch yesterday's P&L summary from vw_true_roas."""
    q = f"""
    SELECT
        ROUND(SUM(ad_spend) / 25000, 0) as spend_usd,
        ROUND(SUM(attributed_revenue) / 25000, 0) as revenue_usd,
        ROUND(AVG(true_roas), 2) as roas,
        COUNT(DISTINCT campaign_id) as active_campaigns
    FROM `{project}.{dataset}.vw_true_roas`
    WHERE ad_date = DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY)
    """
    rows = _bq_query(bq_client, q)
    return rows[0] if rows else {}


def fetch_best_campaign(bq_client, project: str, dataset: str) -> Optional[Dict]:
    """Fetch yesterday's best performing campaign from vw_true_roas."""
    q = f"""
    SELECT
        campaign_name,
        CASE
            WHEN UPPER(campaign_name) LIKE '%_AU_%' THEN 'AU'
            WHEN UPPER(campaign_name) LIKE '%_US_%' THEN 'US'
            ELSE 'AU'
        END as market,
        ROUND(SUM(ad_spend) / 25000, 0) as spend_usd,
        ROUND(SUM(attributed_revenue) / 25000, 0) as revenue_usd,
        ROUND(AVG(true_roas), 2) as roas
    FROM `{project}.{dataset}.vw_true_roas`
    WHERE ad_date = DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY)
      AND ad_spend >= 500000
    GROUP BY 1, 2
    ORDER BY roas DESC
    LIMIT 1
    """
    rows = _bq_query(bq_client, q)
    return rows[0] if rows else None


def fetch_kill_list(bq_client, project: str, dataset: str, threshold: float = 1.5) -> List[Dict]:
    """Campaigns below ROAS threshold yesterday."""
    q = f"""
    SELECT
        campaign_name,
        CASE
            WHEN UPPER(campaign_name) LIKE '%_AU_%' THEN 'AU'
            WHEN UPPER(campaign_name) LIKE '%_US_%' THEN 'US'
            ELSE 'AU'
        END as market,
        ROUND(SUM(ad_spend) / 25000, 0) as spend_usd,
        ROUND(AVG(true_roas), 2) as roas
    FROM `{project}.{dataset}.vw_true_roas`
    WHERE ad_date = DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY)
      AND ad_spend >= 500000
    GROUP BY 1, 2
    HAVING roas < {threshold} OR roas IS NULL
    ORDER BY spend_usd DESC
    LIMIT 5
    """
    return _bq_query(bq_client, q)


def fetch_trending_spy(bq_client, project: str, dataset: str) -> List[Dict]:
    """Top 3 new spy ads from the past 2 days."""
    q = f"""
    SELECT page_name, niche, market, hot_score, headline, ad_url
    FROM `{project}.{dataset}.fb_library_ads`
    WHERE sync_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 2 DAY)
    ORDER BY hot_score DESC
    LIMIT 3
    """
    return _bq_query(bq_client, q)


def fetch_pending_orders(bq_client, project: str, dataset: str) -> Dict[str, int]:
    """Count pending orders by market using vw_fact_daily_pnl_v2."""
    q = f"""
    SELECT
        'ALL' as market,
        SUM(pending_orders) as pending_count
    FROM `{project}.{dataset}.vw_fact_daily_pnl_v2`
    WHERE report_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 3 DAY)
    """
    rows = _bq_query(bq_client, q)
    result = {}
    for r in rows:
        mkt = str(r.get('market', 'ALL')).upper()
        count = r.get('pending_count') or 0
        if count:
            result[mkt] = int(count)
    return result


# ─── Message builder ──────────────────────────────────────────────────────────

def build_briefing_message(
    pnl: Dict,
    best_camp: Optional[Dict],
    kill_list: List[Dict],
    trending_spy: List[Dict],
    pending_orders: Dict,
    date_str: str,
) -> str:
    """Assemble the Telegram briefing message (HTML format)."""
    spend = pnl.get("spend_usd") or 0
    revenue = pnl.get("revenue_usd") or 0
    roas = pnl.get("roas") or 0
    campaigns = pnl.get("active_campaigns") or 0

    roas_tag = "OK" if roas >= 2.5 else ("WARN" if roas >= 1.5 else "BAD")

    lines = [
        f"<b>AUUS1 Morning Briefing - {date_str}</b>",
        "--------------------",
        f"Revenue: <b>${revenue:,.0f}</b>",
        f"Spend: ${spend:,.0f} | ROAS: <b>{roas:.2f}x [{roas_tag}]</b>",
        f"Active campaigns: {campaigns}",
        "--------------------",
    ]

    if best_camp:
        lines.extend([
            f"<b>Best Campaign:</b> {best_camp.get('campaign_name', 'N/A')} ({best_camp.get('market', '')})",
            f"   ROAS {best_camp.get('roas', 0):.2f}x | Spend ${best_camp.get('spend_usd', 0):,.0f}",
        ])
    else:
        lines.append("<b>Best:</b> No data for yesterday")

    if kill_list:
        lines.append("")
        lines.append(f"<b>Kill List ({len(kill_list)}):</b>")
        for c in kill_list[:3]:
            roas_val = c.get("roas")
            roas_d = f"{roas_val:.2f}x" if roas_val else "N/A"
            name = (c.get('campaign_name') or 'N/A')[:35]
            lines.append(f"  - {name}: {roas_d} / ${c.get('spend_usd', 0):,.0f}")
    else:
        lines.append("Kill List: Clean - no campaigns to kill")

    if trending_spy:
        lines.append("")
        lines.append("<b>Competitor Trends:</b>")
        for ad in trending_spy:
            lines.append(f"  {ad.get('page_name', 'N/A')} [{ad.get('market', '')}] score={ad.get('hot_score', 0):.0f}")

    if pending_orders:
        lines.append("")
        lines.append("<b>Pending Orders:</b>")
        for mkt, count in pending_orders.items():
            lines.append(f"   {mkt}: {count} orders")

    lines.extend([
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        "_AUUS1 Auto Briefing • Level Up Analytics_",
    ])

    return "\n".join(lines)


# ─── Send to Telegram ─────────────────────────────────────────────────────────

async def send_briefing(
    bot_token: str,
    chat_id: str,
    message: str,
) -> Optional[str]:
    """Send briefing message to Telegram. Returns message_id."""
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
            resp = await client.post(url, json={
                "chat_id": chat_id,
                "text": message,
                "parse_mode": "HTML",
            })
            resp.raise_for_status()
            data = resp.json()
            msg_id = str(data.get("result", {}).get("message_id", ""))
            log.info(f"Morning briefing sent (msg_id={msg_id})")
            return msg_id
    except Exception as e:
        log.error(f"Briefing send failed: {e}")
        return None


# ─── Main briefing function ───────────────────────────────────────────────────

async def generate_and_send(project_id: str = "AUUS1", dry_run: bool = False) -> Dict:
    """
    Generate daily briefing and send to Telegram.
    Call this at 8am ICT (1am UTC) via scheduler.
    """
    from faos_brain.config import settings
    from google.cloud import bigquery

    bq = bigquery.Client(project=settings.gcp_project_id)
    proj = settings.gcp_project_id
    dataset = settings.bq_dataset

    yesterday = (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%d/%m/%Y")

    # Fetch all data in parallel using asyncio
    import asyncio
    loop = asyncio.get_event_loop()

    # These are sync BQ calls — run them normally
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

    result = {
        "date": yesterday,
        "message_preview": message[:500],
        "pnl": pnl,
        "best_campaign": best_camp,
        "kill_list_count": len(kill_list),
        "trending_ads": len(trending_spy),
        "sent": False,
    }

    if dry_run:
        log.info(f"[DRY RUN] Morning Briefing:\n{message}")
        return result

    if not settings.telegram_bot_token or not settings.telegram_chat_id:
        log.warning("TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set. Briefing not sent.")
        return result

    msg_id = await send_briefing(
        bot_token=settings.telegram_bot_token,
        chat_id=settings.telegram_chat_id,
        message=message,
    )
    result["sent"] = bool(msg_id)
    result["telegram_msg_id"] = msg_id
    return result


# ─── Scheduler setup with APScheduler ────────────────────────────────────────

_scheduler = None


def start_briefing_scheduler(project_id: str = "AUUS1") -> bool:
    """Start APScheduler to run briefing daily at BRIEFING_HOUR_UTC."""
    global _scheduler
    if not BRIEFING_ENABLED:
        log.info("Morning briefing disabled (BRIEFING_ENABLED=false)")
        return False

    try:
        from apscheduler.schedulers.asyncio import AsyncIOScheduler
        import asyncio

        _scheduler = AsyncIOScheduler(timezone="UTC")
        _scheduler.add_job(
            generate_and_send,
            trigger="cron",
            hour=BRIEFING_HOUR_UTC,
            minute=0,
            kwargs={"project_id": project_id},
            id="morning_briefing",
            replace_existing=True,
        )
        _scheduler.start()
        log.info(f"Morning briefing scheduler started — fires at {BRIEFING_HOUR_UTC:02d}:00 UTC daily")
        return True
    except ImportError:
        log.warning("APScheduler not installed. Install: pip install apscheduler")
        return False
    except Exception as e:
        log.error(f"Scheduler start failed: {e}")
        return False


def stop_briefing_scheduler() -> None:
    global _scheduler
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
        log.info("Morning briefing scheduler stopped.")
