"""
Data Gates — Pre-run data quality validation.

Split from daily_analysis.py for maintainability.
Contains:
    - DataGateResult: Result of a single data quality check
    - validate_data_gates(): Check all data sources meet quality thresholds
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from google.cloud import bigquery

from faos_brain.config import settings
from faos_brain.state_machine import HeartbeatState

log = logging.getLogger("faos.workflow")


class DataGateResult:
    """Result of a single data quality check."""

    def __init__(self, name: str, passed: bool, detail: str) -> None:
        self.name = name
        self.passed = passed
        self.detail = detail

    def __repr__(self) -> str:
        icon = "✅" if self.passed else "❌"
        return f"{icon} {self.name}: {self.detail}"


async def validate_data_gates(workflow) -> List[DataGateResult]:
    """
    Pre-run validation: check all data sources meet quality thresholds.

    Gates (Doc 05 §1 — T3 DATA_SYNCED guard):
    1. Orders data exists for today (BQ daily_performance)
    2. Ads data exists for today (BQ daily_performance)
    3. Attribution rate ≥ 85% (orders matched to campaigns)
    4. Meta access token is configured and valid

    Args:
        workflow: ForcedWorkflow instance.

    Returns:
        List of DataGateResult. Any failure → EmergencyHaltError.

    Raises:
        EmergencyHaltError: If any gate fails.
    """
    from faos_brain.workflows.daily_analysis import EmergencyHaltError

    log.info("[%s] ═══ DATA VALIDATION START ═══", workflow.run_id)
    workflow._transition(HeartbeatState.DATA_VALIDATION)

    gates: List[DataGateResult] = []
    ds = workflow.run_date.isoformat()
    dataset = f"{settings.gcp_project_id}.{settings.bq_dataset}"

    try:
        bq = workflow._get_bq_client()

        # ── Gate 1: Orders data exists ──
        try:
            query_orders = f"""
                SELECT COUNT(*) AS cnt
                FROM `{dataset}.daily_performance`
                WHERE report_date = '{ds}'
                  AND total_orders > 0
            """
            rows = list(bq.query(query_orders).result())
            orders_count = rows[0].cnt if rows else 0
            gate1 = DataGateResult(
                "ORDERS_DATA",
                passed=orders_count > workflow.MIN_ORDERS_COUNT,
                detail=f"{orders_count} rows with orders for {ds}",
            )
        except Exception as exc:
            gate1 = DataGateResult(
                "ORDERS_DATA", passed=False,
                detail=f"BQ query failed: {exc}",
            )
        gates.append(gate1)

        # ── Gate 2: Ads data exists ──
        try:
            query_ads = f"""
                SELECT COUNT(*) AS cnt
                FROM `{dataset}.daily_performance`
                WHERE report_date = '{ds}'
                  AND ads_spend > 0
            """
            rows = list(bq.query(query_ads).result())
            ads_count = rows[0].cnt if rows else 0
            gate2 = DataGateResult(
                "ADS_DATA",
                passed=ads_count > workflow.MIN_ADS_ROWS,
                detail=f"{ads_count} rows with ads spend for {ds}",
            )
        except Exception as exc:
            gate2 = DataGateResult(
                "ADS_DATA", passed=False,
                detail=f"BQ query failed: {exc}",
            )
        gates.append(gate2)

        # ── Gate 3: Attribution rate ≥ 85% ──
        try:
            query_attr = f"""
                SELECT
                    COUNTIF(campaign_id IS NOT NULL) AS matched,
                    COUNT(*) AS total
                FROM `{dataset}.daily_performance`
                WHERE report_date = '{ds}'
                  AND total_orders > 0
            """
            rows = list(bq.query(query_attr).result())
            if rows and rows[0].total > 0:
                attr_pct = (rows[0].matched / rows[0].total) * 100
            else:
                attr_pct = 0.0
            gate3 = DataGateResult(
                "ATTRIBUTION_RATE",
                passed=attr_pct >= workflow.MIN_ATTRIBUTION_PCT or rows[0].total == 0,
                detail=f"{attr_pct:.1f}% ({rows[0].matched if rows else 0}/{rows[0].total if rows else 0})",
            )
        except Exception as exc:
            gate3 = DataGateResult(
                "ATTRIBUTION_RATE", passed=False,
                detail=f"BQ query failed: {exc}",
            )
        gates.append(gate3)

        # ── Gate 4: Meta token configured ──
        token = settings.meta_access_token
        token_ok = bool(token) and len(token) >= workflow.META_TOKEN_MIN_LENGTH
        gate4 = DataGateResult(
            "META_TOKEN",
            passed=token_ok,
            detail=f"Token length={len(token)}" if token else "NOT CONFIGURED",
        )
        gates.append(gate4)

    except Exception as exc:
        # BQ connection itself failed
        gates.append(DataGateResult(
            "BQ_CONNECTION", passed=False,
            detail=f"Cannot connect to BigQuery: {exc}",
        ))

    # ── Evaluate results ──
    failed_gates = [g for g in gates if not g.passed]

    for g in gates:
        log.info("[%s]   %s", workflow.run_id, g)

    if failed_gates:
        error_lines = "\n".join(f"  {g}" for g in failed_gates)
        error_msg = (
            f"DATA VALIDATION FAILED — {len(failed_gates)}/{len(gates)} gates failed:\n"
            f"{error_lines}"
        )
        log.error("[%s] %s", workflow.run_id, error_msg)

        # Fire emergency alert
        from faos_brain.workflows.workflow_logging import send_emergency_alert
        await send_emergency_alert(workflow, error_msg)

        # Transition to EMERGENCY_HALT
        workflow._transition(HeartbeatState.EMERGENCY_HALT)

        raise EmergencyHaltError(error_msg)

    log.info(
        "[%s] ═══ DATA VALIDATION PASSED ═══ %d/%d gates OK",
        workflow.run_id, len(gates), len(gates),
    )
    return gates
