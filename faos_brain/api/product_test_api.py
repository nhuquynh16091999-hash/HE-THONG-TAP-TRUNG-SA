"""
Product Test API — FastAPI routes for Product Lab dashboard.

Endpoints:
    GET  /api/product-tests              — Full list with AU vs US split
    GET  /api/product-tests/kanban       — Grouped by journey stage
    GET  /api/product-tests/journey/{code} — Timeline for one product
    POST /api/product-tests/note         — Add note to product
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

log = logging.getLogger("faos.api.product_tests")
router = APIRouter(prefix="/api/product-tests", tags=["Product Lab"])

DATASET = "AUUS1_Dataset"
PROJECT_ID = "AUUS1"


class ProductNote(BaseModel):
    product_code: str
    market: Optional[str] = None
    note: str
    action: Optional[str] = None  # "kill" | "scale" | "pause" | "continue"


@router.get("")
async def list_product_tests(
    market: Optional[str] = Query(None, description="Filter: AU | US"),
    stage: Optional[str] = Query(None, description="Filter by journey stage"),
    limit: int = Query(100),
):
    """Get all product test summaries with AU vs US split."""
    try:
        from google.cloud import bigquery
        from faos_brain.config import settings

        bq = bigquery.Client(project=settings.gcp_project_id)
        conditions = []
        if market:
            conditions.append(f"market = '{market.upper()}'")
        if stage:
            conditions.append(f"journey_stage = '{stage}'")
        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""

        q = f"""
        SELECT *
        FROM `{settings.gcp_project_id}.{DATASET}.vw_product_test_summary`
        {where}
        ORDER BY
            CASE journey_stage
                WHEN 'Scaling'   THEN 1
                WHEN 'WIN'       THEN 2
                WHEN 'Potential' THEN 3
                WHEN 'Testing'   THEN 4
                WHEN 'Paused'    THEN 5
                ELSE 6
            END,
            avg_roas DESC
        LIMIT {limit}
        """
        rows = [dict(r) for r in bq.query(q)]

        # Serialize DATE/TIMESTAMP objects
        for row in rows:
            for k, v in row.items():
                if hasattr(v, "isoformat"):
                    row[k] = v.isoformat()

        return {"count": len(rows), "products": rows}
    except Exception as e:
        log.error(f"Product tests list error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/kanban")
async def kanban_board():
    """Get products grouped by journey stage for Kanban view."""
    try:
        from google.cloud import bigquery
        from faos_brain.config import settings

        bq = bigquery.Client(project=settings.gcp_project_id)
        q = f"""
        SELECT *
        FROM `{settings.gcp_project_id}.{DATASET}.vw_product_test_summary`
        ORDER BY avg_roas DESC
        """
        rows = [dict(r) for r in bq.query(q)]

        # Serialize dates
        for row in rows:
            for k, v in row.items():
                if hasattr(v, "isoformat"):
                    row[k] = v.isoformat()

        # Group by stage
        stages = ["Scaling", "WIN", "Potential", "Testing", "Paused"]
        kanban: dict = {s: [] for s in stages}
        for row in rows:
            stage = row.get("journey_stage", "Testing")
            if stage in kanban:
                kanban[stage].append(row)

        return {
            "stages": stages,
            "kanban": kanban,
            "totals": {s: len(kanban[s]) for s in stages},
        }
    except Exception as e:
        log.error(f"Kanban error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/journey/{product_code}")
async def product_journey(product_code: str, market: Optional[str] = Query(None)):
    """Get daily timeline for a specific product code."""
    try:
        from google.cloud import bigquery
        from faos_brain.config import settings

        bq = bigquery.Client(project=settings.gcp_project_id)

        market_cond = ""
        if market:
            m = market.upper()
            if m == "AU":
                market_cond = "AND UPPER(campaign_name) LIKE '%_AU_%'"
            elif m == "US":
                market_cond = "AND UPPER(campaign_name) LIKE '%_US_%'"

        q = f"""
        SELECT
            ad_date AS date,
            CASE
                WHEN UPPER(campaign_name) LIKE '%_AU_%' THEN 'AU'
                WHEN UPPER(campaign_name) LIKE '%_US_%' THEN 'US'
                ELSE 'AU'
            END AS market,
            ROUND(SUM(ad_spend) / 25000, 2) AS spend_usd,
            ROUND(SUM(attributed_revenue) / 25000, 2) AS revenue_usd,
            CAST(SUM(success_orders) AS INT64) AS orders,
            ROUND(SAFE_DIVIDE(SUM(attributed_revenue), NULLIF(SUM(ad_spend), 0)), 3) AS roas
        FROM `{settings.gcp_project_id}.{DATASET}.vw_true_roas`
        WHERE SPLIT(campaign_name, '_')[SAFE_OFFSET(3)] = '{product_code}'
          {market_cond}
        GROUP BY 1, 2
        ORDER BY date ASC
        """
        rows = [dict(r) for r in bq.query(q)]
        for row in rows:
            for k, v in row.items():
                if hasattr(v, "isoformat"):
                    row[k] = v.isoformat()

        return {"product_code": product_code, "market": market, "history": rows}
    except Exception as e:
        log.error(f"Journey error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/note")
async def add_product_note(note: ProductNote):
    """
    Log a note/decision for a product.
    Stored in BQ table product_notes (auto-created if not exists).
    """
    try:
        from google.cloud import bigquery
        from faos_brain.config import settings
        from datetime import datetime, timezone
        import uuid

        bq = bigquery.Client(project=settings.gcp_project_id)
        table_id = f"{settings.gcp_project_id}.{DATASET}.product_notes"

        row = {
            "note_id": f"note_{uuid.uuid4().hex[:12]}",
            "product_code": note.product_code,
            "market": (note.market or "ALL").upper(),
            "note": note.note[:1000],
            "action": note.action,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }

        errors = bq.insert_rows_json(table_id, [row])
        if errors:
            log.warning(f"Note insert warning: {errors}")

        return {"status": "ok", "note_id": row["note_id"]}
    except Exception as e:
        log.error(f"Note error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
