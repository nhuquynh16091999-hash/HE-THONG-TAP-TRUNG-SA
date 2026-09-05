"""
Budget Optimizer API — AI-powered budget reallocation suggestions.

Analyzes campaign ROAS trends and suggests budget increases/decreases.

Endpoints:
  GET /api/budget/suggestions   — campaign budget suggestions with reasons
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List

from fastapi import APIRouter
from pydantic import BaseModel

log = logging.getLogger("faos.api.budget")
router = APIRouter(prefix="/api/budget", tags=["budget-optimizer"])


class BudgetSuggestion(BaseModel):
    campaign_id: str
    campaign_name: str
    market: str
    current_spend_daily: float
    roas_3d: float
    roas_7d: float
    roas_trend: str          # improving / stable / declining
    action: str              # INCREASE / DECREASE / HOLD
    suggested_change_pct: int
    reason: str
    priority: str            # high / medium / low


class BudgetResponse(BaseModel):
    total_campaigns: int
    increase_count: int
    decrease_count: int
    hold_count: int
    suggestions: List[Dict[str, Any]]


@router.get("/suggestions", response_model=BudgetResponse)
async def get_budget_suggestions(market: str = "ALL"):
    """Get AI-powered budget optimization suggestions."""
    from google.cloud import bigquery
    from faos_brain.config import settings

    bq = bigquery.Client(project=settings.gcp_project_id)

    market_filter = ""
    if market != "ALL":
        market_filter = f"AND market = '{market}'"

    q = f"""
    WITH campaign_3d AS (
        SELECT
            CAST(campaign_id AS STRING) as campaign_id,
            campaign_name,
            CASE
                WHEN UPPER(campaign_name) LIKE '%_AU_%' THEN 'AU'
                WHEN UPPER(campaign_name) LIKE '%_US_%' THEN 'US'
                ELSE 'AU'
            END AS market,
            ROUND(SUM(ad_spend) / 25000 / 3, 2)    AS daily_spend,
            ROUND(AVG(true_roas), 3)                AS roas_3d,
            SUM(success_orders)                     AS orders_3d
        FROM `{settings.gcp_project_id}.{settings.bq_dataset}.vw_true_roas`
        WHERE ad_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 3 DAY)
        GROUP BY 1, 2, 3
        HAVING daily_spend >= 5
    ),
    campaign_7d AS (
        SELECT
            CAST(campaign_id AS STRING) as campaign_id,
            ROUND(AVG(true_roas), 3) AS roas_7d,
            SUM(success_orders) AS orders_7d
        FROM `{settings.gcp_project_id}.{settings.bq_dataset}.vw_true_roas`
        WHERE ad_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
        GROUP BY 1
    )
    SELECT
        c3.campaign_id,
        c3.campaign_name,
        c3.market,
        c3.daily_spend,
        c3.roas_3d,
        COALESCE(c7.roas_7d, 0) AS roas_7d,
        c3.orders_3d,
        COALESCE(c7.orders_7d, 0) AS orders_7d
    FROM campaign_3d c3
    LEFT JOIN campaign_7d c7 ON c3.campaign_id = c7.campaign_id
    WHERE 1=1 {market_filter}
    ORDER BY c3.daily_spend DESC
    """

    try:
        rows = list(bq.query(q).result())
    except Exception as e:
        log.error(f"Budget query failed: {e}")
        rows = []

    suggestions = []
    for r in rows:
        d = dict(r)
        roas_3d = d.get("roas_3d") or 0
        roas_7d = d.get("roas_7d") or 0
        daily_spend = d.get("daily_spend") or 0

        # Determine trend
        if roas_7d > 0:
            trend_ratio = roas_3d / roas_7d
        else:
            trend_ratio = 1.0

        if trend_ratio > 1.15:
            trend = "improving"
        elif trend_ratio < 0.85:
            trend = "declining"
        else:
            trend = "stable"

        # Determine action
        if roas_3d >= 3.0 and trend in ("improving", "stable"):
            action = "INCREASE"
            pct = 30 if roas_3d >= 4.0 else 20
            reason = f"ROAS {roas_3d:.1f}x strong, trend {trend}"
            priority = "high"
        elif roas_3d >= 2.0 and trend == "improving":
            action = "INCREASE"
            pct = 15
            reason = f"ROAS improving ({roas_7d:.1f}x -> {roas_3d:.1f}x)"
            priority = "medium"
        elif roas_3d < 1.0 and daily_spend > 15:
            action = "DECREASE"
            pct = -50 if roas_3d < 0.5 else -30
            reason = f"ROAS {roas_3d:.1f}x below breakeven, wasting ${daily_spend:.0f}/day"
            priority = "high"
        elif roas_3d < 1.5 and trend == "declining":
            action = "DECREASE"
            pct = -25
            reason = f"ROAS declining ({roas_7d:.1f}x -> {roas_3d:.1f}x)"
            priority = "medium"
        else:
            action = "HOLD"
            pct = 0
            reason = f"ROAS {roas_3d:.1f}x acceptable, trend {trend}"
            priority = "low"

        suggestions.append({
            "campaign_id": d.get("campaign_id", ""),
            "campaign_name": d.get("campaign_name", ""),
            "market": d.get("market", ""),
            "current_spend_daily": round(daily_spend, 2),
            "roas_3d": round(roas_3d, 3),
            "roas_7d": round(roas_7d, 3),
            "roas_trend": trend,
            "action": action,
            "suggested_change_pct": pct,
            "reason": reason,
            "priority": priority,
        })

    # Sort: DECREASE high priority first, then INCREASE, then HOLD
    action_order = {"DECREASE": 0, "INCREASE": 1, "HOLD": 2}
    priority_order = {"high": 0, "medium": 1, "low": 2}
    suggestions.sort(key=lambda s: (action_order.get(s["action"], 2), priority_order.get(s["priority"], 2)))

    return BudgetResponse(
        total_campaigns=len(suggestions),
        increase_count=sum(1 for s in suggestions if s["action"] == "INCREASE"),
        decrease_count=sum(1 for s in suggestions if s["action"] == "DECREASE"),
        hold_count=sum(1 for s in suggestions if s["action"] == "HOLD"),
        suggestions=suggestions,
    )
