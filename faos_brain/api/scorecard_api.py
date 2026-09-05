"""
Marketer Scorecard API — Weekly performance leaderboard.

Endpoints:
  GET /api/scorecard           — weekly leaderboard
  GET /api/scorecard/{mkter}   — detail for one marketer
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List

from fastapi import APIRouter

log = logging.getLogger("faos.api.scorecard")
router = APIRouter(prefix="/api/scorecard", tags=["scorecard"])


@router.get("")
async def weekly_leaderboard():
    """Get weekly marketer leaderboard."""
    from google.cloud import bigquery
    from faos_brain.config import settings

    bq = bigquery.Client(project=settings.gcp_project_id)
    q = f"""
    SELECT *
    FROM `{settings.gcp_project_id}.{settings.bq_dataset}.vw_marketer_scorecard`
    ORDER BY overall_rank ASC
    """
    try:
        rows = list(bq.query(q).result())
        marketers = []
        for r in rows:
            d = dict(r)
            if d.get("week_start"):
                d["week_start"] = d["week_start"].isoformat()
            if d.get("refreshed_at"):
                d["refreshed_at"] = str(d["refreshed_at"])
            marketers.append(d)
    except Exception as e:
        log.error(f"Scorecard query failed: {e}")
        marketers = []

    return {"count": len(marketers), "leaderboard": marketers}


@router.get("/{mkter_code}")
async def marketer_detail(mkter_code: str):
    """Get detailed performance for one marketer."""
    from google.cloud import bigquery
    from faos_brain.config import settings

    bq = bigquery.Client(project=settings.gcp_project_id)

    # Weekly history for this marketer
    q = f"""
    WITH marketer_weekly AS (
        SELECT
            SPLIT(campaign_name, '_')[SAFE_OFFSET(1)] AS mkter,
            DATE_TRUNC(ad_date, WEEK(MONDAY)) AS week_start,
            ROUND(SUM(ad_spend) / 25000, 2) AS spend,
            ROUND(SUM(attributed_revenue) / 25000, 2) AS revenue,
            CAST(SUM(success_orders) AS INT64) AS orders,
            ROUND(AVG(true_roas), 3) AS roas,
            COUNT(DISTINCT SPLIT(campaign_name, '_')[SAFE_OFFSET(3)]) AS products
        FROM `{settings.gcp_project_id}.{settings.bq_dataset}.vw_true_roas`
        WHERE SPLIT(campaign_name, '_')[SAFE_OFFSET(1)] = '{mkter_code}'
          AND ad_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 56 DAY)
        GROUP BY 1, 2
    )
    SELECT * FROM marketer_weekly ORDER BY week_start DESC
    """

    try:
        rows = list(bq.query(q).result())
        weeks = []
        for r in rows:
            d = dict(r)
            if d.get("week_start"):
                d["week_start"] = d["week_start"].isoformat()
            weeks.append(d)
    except Exception as e:
        log.error(f"Detail query failed: {e}")
        weeks = []

    # Top campaigns this week
    q2 = f"""
    SELECT
        campaign_name,
        ROUND(SUM(ad_spend)/25000, 2) AS spend,
        ROUND(AVG(true_roas), 2) AS roas,
        SUM(success_orders) AS orders
    FROM `{settings.gcp_project_id}.{settings.bq_dataset}.vw_true_roas`
    WHERE SPLIT(campaign_name, '_')[SAFE_OFFSET(1)] = '{mkter_code}'
      AND ad_date >= DATE_TRUNC(CURRENT_DATE(), WEEK(MONDAY))
    GROUP BY 1
    ORDER BY roas DESC
    LIMIT 5
    """
    try:
        top = [dict(r) for r in bq.query(q2).result()]
    except Exception:
        top = []

    return {
        "mkter_code": mkter_code,
        "weekly_history": weeks,
        "top_campaigns_this_week": top,
    }
