"""
CAPI Push — Meta Conversions API push workflow.

Ref: docs/02_Database_and_API_Specs.md Section 5 (CAPI payload)
Ref: docs/05_System_State_Machines.md Level 1 (CAPI_PUSH state)

Runs at 21:00 daily. Pipeline:
    1. Query BQ for success orders (exclude already-pushed via capi_push_log)
    2. Hash PII with SHA256 per Meta requirements                       [capi_transform]
    3. POST Purchase events to Meta CAPI v21.0
    4. Log results to capi_push_log (idempotency)

Deduplication: event_id = order_id (Meta dedup with browser pixel).
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional

import httpx
from google.cloud import bigquery

from faos_brain.config import settings

# ── Re-export split modules for backward compat ──
from faos_brain.workflows.capi_transform import (
    hash_field,        # noqa: F401
    normalize_phone,   # noqa: F401
    remove_diacritics, # noqa: F401
    hash_user_data as _hash_user_data_fn,
    build_event as _build_event_fn,
)

log = logging.getLogger("faos.capi")

# Meta CAPI endpoint
META_CAPI_URL = "https://graph.facebook.com/v21.0/{pixel_id}/events"


class CAPIPushWorkflow:
    """
    Meta Conversions API (CAPI) push scheduler.

    Queries BQ for success orders → hashes user data (SHA256)
    → posts Purchase events to Meta CAPI endpoint → logs to BQ.
    """

    BATCH_SIZE = 100

    def __init__(
        self,
        project_id: str,
        push_date: Optional[date] = None,
        test_event_code: Optional[str] = None,
    ) -> None:
        self.project_id = project_id
        self.push_date = push_date or date.today()
        self.test_event_code = test_event_code
        self._bq: Optional[bigquery.Client] = None

    def _get_bq_client(self) -> bigquery.Client:
        if self._bq is None:
            self._bq = bigquery.Client(project=settings.gcp_project_id)
        return self._bq

    # ═══════════════════════════════════════════
    # 1. Fetch Success Orders from BQ
    # ═══════════════════════════════════════════
    async def fetch_success_orders(self) -> List[Dict[str, Any]]:
        """Query BQ for success (delivered/confirmed) orders."""
        log.info("[CAPI] Fetching success orders for %s...", self.push_date)

        dataset = f"{settings.gcp_project_id}.{settings.bq_dataset}"
        ds = self.push_date.isoformat()

        if self.project_id == 'auus1':
            query = f"""
                SELECT
                    o.order_id,
                    o.order_date,
                    UNIX_SECONDS(TIMESTAMP(o.order_date)) AS event_time,
                    o.bill_phone_number             AS customer_phone,
                    ''                              AS customer_email,
                    o.customer_name,
                    o.shipping_province             AS customer_city,
                    o.derived_market_code           AS customer_country_code,
                    o.total_price                   AS value,
                    o.order_currency                AS currency,
                    STRING_AGG(DISTINCT pi.custom_id) AS content_ids,
                    COUNT(DISTINCT oi.product_id)   AS num_items
                FROM `{dataset}.vw_fact_orders` o
                JOIN `{dataset}.fact_order_items_dedup` oi
                    ON o.order_id = oi.order_id
                LEFT JOIN `{dataset}.product_template` pi
                    ON oi.product_id = pi.id
                WHERE o.status_group = 'success'
                  AND o.order_date = '{ds}'
                  AND o.order_id NOT IN (
                      SELECT event_id
                      FROM `{dataset}.capi_push_log`
                      WHERE push_date = '{ds}'
                  )
                GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10
            """
        else:
            query = f"""
                SELECT
                    o.order_id,
                    o.order_date,
                    UNIX_SECONDS(TIMESTAMP(o.order_date)) AS event_time,
                    o.customer_phone,
                    o.customer_email,
                    o.customer_name,
                    o.customer_city,
                    o.customer_country_code,
                    o.total_amount_ron              AS value,
                    'RON'                           AS currency,
                    STRING_AGG(DISTINCT pi.custom_id) AS content_ids,
                    COUNT(DISTINCT oi.product_id)   AS num_items
                FROM `{dataset}.vw_fact_orders` o
                JOIN `{dataset}.fact_order_items_dedup` oi
                    ON o.order_id = oi.order_id
                LEFT JOIN `{dataset}.product_template` pi
                    ON oi.product_id = pi.id
                WHERE o.status_group = 'success'
                  AND o.order_date = '{ds}'
                  AND o.order_id NOT IN (
                      SELECT event_id
                      FROM `{dataset}.capi_push_log`
                      WHERE push_date = '{ds}'
                  )
                GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10
            """

        try:
            bq = self._get_bq_client()
            rows = list(bq.query(query).result())

            orders = []
            for row in rows:
                orders.append({
                    "order_id": row.order_id,
                    "order_date": str(row.order_date),
                    "event_time": row.event_time,
                    "customer_phone": row.customer_phone or "",
                    "customer_email": row.customer_email or "",
                    "customer_name": row.customer_name or "",
                    "customer_city": row.customer_city or "",
                    "customer_country_code": row.customer_country_code or "ro",
                    "value": float(row.value or 0),
                    "currency": row.currency,
                    "content_ids": (row.content_ids or "").split(","),
                    "num_items": row.num_items or 1,
                })

            log.info("[CAPI] Found %d unpushed success orders.", len(orders))
            return orders

        except Exception as exc:
            log.error("[CAPI] BQ query failed: %s", exc)
            return []

    # ═══════════════════════════════════════════
    # Delegated methods (backward compat wrappers)
    # ═══════════════════════════════════════════

    @staticmethod
    def hash_field(value: str) -> Optional[str]:
        """SHA256 hash a single field per Meta CAPI requirements."""
        return hash_field(value)

    @staticmethod
    def normalize_phone(phone: str) -> Optional[str]:
        """Normalize phone number for Meta CAPI hashing."""
        return normalize_phone(phone)

    @staticmethod
    def remove_diacritics(text: str) -> str:
        """Remove diacritics from text."""
        return remove_diacritics(text)

    def hash_user_data(self, order: Dict[str, Any]) -> Dict[str, Any]:
        """Build hashed user_data object per Meta CAPI spec."""
        return _hash_user_data_fn(order)

    def build_event(self, order: Dict[str, Any]) -> Dict[str, Any]:
        """Build a single CAPI Purchase event from an order."""
        return _build_event_fn(order)

    # ═══════════════════════════════════════════
    # 4. Push Events to Meta CAPI
    # ═══════════════════════════════════════════
    async def push_to_capi(
        self,
        events: List[Dict[str, Any]],
        dry_run: bool = True,
    ) -> Dict[str, Any]:
        """POST Purchase events to Meta Conversions API."""
        if not events:
            log.info("[CAPI] No events to push.")
            return {"total_events": 0, "events_received": 0}

        pixel_id = settings.meta_pixel_id
        access_token = settings.meta_access_token

        if not pixel_id or not access_token:
            log.error("[CAPI] Missing pixel_id or access_token in config.")
            return {"total_events": len(events), "events_received": 0, "error": "Missing config"}

        url = META_CAPI_URL.format(pixel_id=pixel_id)
        total_received = 0
        fbtrace_ids: List[str] = []
        errors: List[str] = []

        for i in range(0, len(events), self.BATCH_SIZE):
            batch = events[i: i + self.BATCH_SIZE]
            batch_num = (i // self.BATCH_SIZE) + 1

            payload: Dict[str, Any] = {
                "data": batch,
                "access_token": access_token,
            }

            if self.test_event_code:
                payload["test_event_code"] = self.test_event_code

            if dry_run:
                log.info("[CAPI] DRY RUN — batch %d: %d events (not sent)", batch_num, len(batch))
                total_received += len(batch)
                continue

            try:
                async with httpx.AsyncClient(timeout=30) as client:
                    resp = await client.post(url, json=payload)

                    if resp.status_code == 200:
                        result = resp.json()
                        received = result.get("events_received", 0)
                        fbtrace = result.get("fbtrace_id", "")
                        total_received += received
                        if fbtrace:
                            fbtrace_ids.append(fbtrace)
                        log.info("[CAPI] Batch %d: %d/%d events received", batch_num, received, len(batch))
                    else:
                        error_body = resp.text[:500]
                        errors.append(f"Batch {batch_num}: HTTP {resp.status_code} — {error_body}")
                        log.error("[CAPI] Batch %d FAILED: HTTP %d", batch_num, resp.status_code)

            except Exception as exc:
                errors.append(f"Batch {batch_num}: {exc}")
                log.error("[CAPI] Batch %d exception: %s", batch_num, exc)

        return {
            "total_events": len(events),
            "events_received": total_received,
            "fbtrace_ids": fbtrace_ids,
            "errors": errors,
        }

    # ═══════════════════════════════════════════
    # 5. Log Results to BQ (Idempotency)
    # ═══════════════════════════════════════════
    async def log_push_results(
        self,
        orders: List[Dict[str, Any]],
        push_result: Dict[str, Any],
    ) -> None:
        """Log pushed events to BQ capi_push_log for idempotency."""
        if not orders:
            return

        try:
            bq = self._get_bq_client()
            table_id = f"{settings.gcp_project_id}.{settings.bq_dataset}.capi_push_log"

            rows = []
            for order in orders:
                rows.append({
                    "event_id": order["order_id"],
                    "push_date": self.push_date.isoformat(),
                    "pixel_id": settings.meta_pixel_id,
                    "http_status": 200 if not push_result.get("errors") else 500,
                    "events_received": push_result.get("events_received", 0),
                    "fbtrace_id": (push_result.get("fbtrace_ids", [""])[0] or "")[:100],
                    "pushed_at": datetime.now(timezone.utc).isoformat(),
                })

            errors = bq.insert_rows_json(table_id, rows)
            if errors:
                log.error("[CAPI] BQ capi_push_log insert errors: %s", errors)
            else:
                log.info("[CAPI] Logged %d events to capi_push_log.", len(rows))

        except Exception as exc:
            log.error("[CAPI] Failed to log to BQ: %s", exc)

    # ═══════════════════════════════════════════
    # 6. Main Orchestrator
    # ═══════════════════════════════════════════
    async def run(self, dry_run: bool = True) -> Dict[str, Any]:
        """Execute the full CAPI push workflow."""
        log.info("═══ CAPI PUSH START ═══ project=%s date=%s dry_run=%s",
                 self.project_id, self.push_date, dry_run)

        orders = await self.fetch_success_orders()

        if not orders:
            log.info("═══ CAPI PUSH: No orders to push ═══")
            return {"status": "SKIPPED", "reason": "No unpushed success orders", "order_count": 0}

        events = [self.build_event(order) for order in orders]
        log.info("[CAPI] Built %d CAPI events.", len(events))

        push_result = await self.push_to_capi(events, dry_run=dry_run)

        if push_result.get("events_received", 0) > 0 or dry_run:
            await self.log_push_results(orders, push_result)

        summary = {
            "status": "SUCCESS" if not push_result.get("errors") else "PARTIAL",
            "order_count": len(orders),
            "events_pushed": push_result.get("events_received", 0),
            "errors": push_result.get("errors", []),
            "fbtrace_ids": push_result.get("fbtrace_ids", []),
        }

        log.info("═══ CAPI PUSH DONE ═══ orders=%d pushed=%d errors=%d",
                 len(orders), push_result.get("events_received", 0), len(push_result.get("errors", [])))
        return summary
