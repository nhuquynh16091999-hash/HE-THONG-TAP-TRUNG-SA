"""
FAOS v6 — Funnel Analysis.

Provides full marketing funnel breakdown per campaign:
  Impressions → Clicks → Leads → Orders → Delivered

Identifies bottleneck stage and compares against project benchmarks.
KEY RULE: Kill despite good CPL if return_rate > 40%.
"""

import logging
from dataclasses import dataclass, field
from datetime import date
from typing import Any, List, Optional

from faos_brain.optimization.config import OptimizationConfig, get_project_config
from faos_brain.optimization.diagnostic import FunnelScorecard

logger = logging.getLogger(__name__)


@dataclass
class FunnelReport:
    """Aggregated funnel report across all campaigns."""
    project_id: str
    report_date: date
    campaigns: List[FunnelScorecard] = field(default_factory=list)

    # Project-level aggregates
    total_impressions: int = 0
    total_clicks: int = 0
    total_leads: int = 0
    total_orders: int = 0
    total_delivered: int = 0
    total_returned: int = 0

    # Project-level rates
    overall_ctr: float = 0.0
    overall_click_to_lead: float = 0.0
    overall_lead_to_order: float = 0.0
    overall_order_to_deliver: float = 0.0
    overall_return_rate: float = 0.0

    # Campaigns with bottlenecks
    bottleneck_campaigns: List[FunnelScorecard] = field(default_factory=list)
    high_return_campaigns: List[FunnelScorecard] = field(default_factory=list)


class FunnelAnalyzer:
    """
    Analyzes full marketing funnel per campaign.
    Identifies bottlenecks and high-return-rate campaigns.
    """

    def __init__(
        self,
        project_id: str,
        run_date: Optional[date] = None,
        bq_client: Any = None,
        config: Optional[OptimizationConfig] = None,
    ):
        self.project_id = project_id
        self.run_date = run_date or date.today()
        self.bq_client = bq_client
        self.config = config or get_project_config(project_id)

    async def analyze(self, funnels: Optional[List[FunnelScorecard]] = None) -> FunnelReport:
        """
        Analyze funnels. Can accept pre-fetched data from CampaignDiagnostic
        or query BQ directly.
        """
        logger.info(f"[{self.project_id}] Running funnel analysis for {self.run_date}")

        report = FunnelReport(
            project_id=self.project_id,
            report_date=self.run_date,
        )

        if funnels is None:
            funnels = await self._fetch_funnels()

        if not funnels:
            logger.info("No funnel data available")
            return report

        report.campaigns = funnels

        # Aggregate project-level
        report.total_impressions = sum(f.impressions for f in funnels)
        report.total_clicks = sum(f.clicks for f in funnels)
        report.total_leads = sum(f.leads for f in funnels)
        report.total_orders = sum(f.orders for f in funnels)
        report.total_delivered = sum(f.delivered for f in funnels)
        report.total_returned = sum(f.returned for f in funnels)

        # Overall rates
        if report.total_impressions > 0:
            report.overall_ctr = report.total_clicks / report.total_impressions
        if report.total_clicks > 0:
            report.overall_click_to_lead = report.total_leads / report.total_clicks
        if report.total_leads > 0:
            report.overall_lead_to_order = report.total_orders / report.total_leads
        if report.total_orders > 0:
            report.overall_order_to_deliver = report.total_delivered / report.total_orders
            report.overall_return_rate = report.total_returned / report.total_orders

        # Identify problem campaigns
        for fn in funnels:
            if fn.bottleneck_stage != "NO_BOTTLENECK":
                report.bottleneck_campaigns.append(fn)
            if fn.return_rate > self.config.return_rate_kill:
                report.high_return_campaigns.append(fn)

        logger.info(
            f"[{self.project_id}] Funnel analysis: {len(funnels)} campaigns, "
            f"{len(report.bottleneck_campaigns)} bottlenecks, "
            f"{len(report.high_return_campaigns)} high-return"
        )

        return report

    async def _fetch_funnels(self) -> List[FunnelScorecard]:
        """Fetch funnel data from BQ vw_spend_funnel."""
        if not self.bq_client:
            return []

        query = f"""
        SELECT *
        FROM `levelup-465304.{self.config.dataset}.vw_spend_funnel`
        ORDER BY total_spend DESC
        LIMIT 20
        """
        rows = list(self.bq_client.query(query).result())
        return [
            FunnelScorecard(
                campaign_id=r.campaign_id,
                campaign_name=r.campaign_name or "",
                impressions=int(r.impressions or 0),
                clicks=int(r.clicks or 0),
                leads=int(r.leads or 0),
                orders=int(r.orders or 0),
                delivered=int(r.delivered or 0),
                returned=int(r.returned or 0),
                stage1_ctr=float(r.stage1_ctr or 0),
                stage2_click_to_lead=float(r.stage2_click_to_lead or 0),
                stage3_lead_to_order=float(r.stage3_lead_to_order or 0),
                stage4_order_to_deliver=float(r.stage4_order_to_deliver or 0),
                return_rate=float(r.return_rate or 0),
                bottleneck_stage=r.bottleneck_stage or "NO_BOTTLENECK",
                confirmed_roas_7d=float(r.confirmed_roas_7d or 0),
            )
            for r in rows
        ]
