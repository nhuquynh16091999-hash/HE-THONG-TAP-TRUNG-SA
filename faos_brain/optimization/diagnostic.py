"""
FAOS v6 — Campaign Diagnostic Engine.

Queries vw_campaign_diagnostic + vw_spend_funnel from BigQuery.
Returns pre-scored data (anomalies + top/bottom performers).
LLM receives DiagnosticReport, NOT raw 50-column data.

Operational rules:
- LEARNING mode: campaigns < 7 days → observe only, no Kill
  Exception: CTR < 0.2% AND Hook Rate < 5% → Kill allowed
- Slope = warning only, never sole Kill trigger
- All outputs are RECOMMEND_ONLY during human-in-the-loop period
"""

import logging
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Dict, List, Optional

from faos_brain.optimization.config import (
    ExecutionMode,
    OptimizationConfig,
    get_project_config,
)

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════
# Data Models
# ═══════════════════════════════════════════════════════════════════

@dataclass
class CampaignScorecard:
    """Win/Fail scorecard for a single campaign."""
    campaign_id: str
    campaign_name: str
    status: str                     # WIN | OKAY | FAIL | LEARNING
    primary_signal: str             # WEAK_HOOK | LOW_CTR | ... | HEALTHY
    recommended_action: str         # RECOMMEND_SCALE | RECOMMEND_KILL | MONITOR | OBSERVE
    targeting_country: str = ""
    creative_type: str = ""
    campaign_age_days: int = 0

    # Key metrics
    spend: float = 0.0
    confirmed_roas: float = 0.0
    confirmed_roas_ma7: float = 0.0
    ctr: float = 0.0
    cpm: float = 0.0
    hook_rate: Optional[float] = None
    frequency: float = 0.0
    cost_per_lead: float = 0.0
    lead_to_order_rate: float = 0.0
    return_rate: float = 0.0
    roas_momentum: str = "STABLE"

    # Vs project average
    vs_avg_ctr: float = 0.0
    vs_avg_cpm: float = 0.0
    vs_avg_roas: float = 0.0


@dataclass
class FunnelScorecard:
    """Funnel analysis for a single campaign."""
    campaign_id: str
    campaign_name: str
    impressions: int = 0
    clicks: int = 0
    leads: int = 0
    orders: int = 0
    delivered: int = 0
    returned: int = 0
    stage1_ctr: float = 0.0
    stage2_click_to_lead: float = 0.0
    stage3_lead_to_order: float = 0.0
    stage4_order_to_deliver: float = 0.0
    return_rate: float = 0.0
    bottleneck_stage: str = "NO_BOTTLENECK"
    confirmed_roas_7d: float = 0.0


@dataclass
class DiagnosticReport:
    """Complete diagnostic report — ready for LLM + Telegram."""
    project_id: str
    report_date: date
    execution_mode: str

    # Pre-scored data (LLM gets THESE, not raw data)
    top_wins: List[CampaignScorecard] = field(default_factory=list)
    top_fails: List[CampaignScorecard] = field(default_factory=list)
    learning_campaigns: List[CampaignScorecard] = field(default_factory=list)
    okay_campaigns: List[CampaignScorecard] = field(default_factory=list)
    funnels: List[FunnelScorecard] = field(default_factory=list)

    # Anomalies (high-priority signals)
    anomalies: List[str] = field(default_factory=list)

    # Generated narrative (from LLM)
    narrative: str = ""

    # Stats
    total_campaigns: int = 0
    total_spend: float = 0.0

    @property
    def has_data(self) -> bool:
        return self.total_campaigns > 0


# ═══════════════════════════════════════════════════════════════════
# Campaign Diagnostic Engine
# ═══════════════════════════════════════════════════════════════════

class CampaignDiagnostic:
    """
    Queries BQ views → produces DiagnosticReport with Win/Fail scorecards.

    The report contains PRE-SCORED data — the LLM receives only
    anomalies and top/bottom performers, NOT raw 50-column data.
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

    async def run(self) -> DiagnosticReport:
        """
        Main entry point. Query BQ views → build DiagnosticReport.
        """
        logger.info(
            f"[{self.project_id}] Running campaign diagnostic "
            f"for {self.run_date} (mode: {self.config.execution_mode.value})"
        )

        report = DiagnosticReport(
            project_id=self.project_id,
            report_date=self.run_date,
            execution_mode=self.config.execution_mode.value,
        )

        try:
            # 1. Fetch campaign scorecards from vw_campaign_diagnostic
            scorecards = await self._fetch_campaign_scorecards()

            # 2. Fetch funnel data from vw_spend_funnel
            funnels = await self._fetch_funnel_data()

            # 3. Classify campaigns
            for sc in scorecards:
                if sc.status == "WIN":
                    report.top_wins.append(sc)
                elif sc.status == "FAIL":
                    report.top_fails.append(sc)
                elif sc.status == "LEARNING":
                    report.learning_campaigns.append(sc)
                else:
                    report.okay_campaigns.append(sc)

            # Sort: top wins by ROAS desc, top fails by ROAS asc
            report.top_wins.sort(key=lambda x: x.confirmed_roas_ma7, reverse=True)
            report.top_fails.sort(key=lambda x: x.confirmed_roas_ma7)

            # Limit to top 5 each
            report.top_wins = report.top_wins[:5]
            report.top_fails = report.top_fails[:5]

            report.funnels = funnels
            report.total_campaigns = len(scorecards)
            report.total_spend = sum(sc.spend for sc in scorecards)

            # 4. Detect anomalies
            report.anomalies = self._detect_anomalies(scorecards, funnels)

            logger.info(
                f"[{self.project_id}] Diagnostic complete: "
                f"{len(report.top_wins)} wins, {len(report.top_fails)} fails, "
                f"{len(report.learning_campaigns)} learning, "
                f"{len(report.anomalies)} anomalies"
            )

        except Exception as e:
            logger.error(f"[{self.project_id}] Diagnostic failed: {e}")
            report.anomalies.append(f"⚠️ Diagnostic error: {e}")

        return report

    # ─── Data Fetching ───

    async def _fetch_campaign_scorecards(self) -> List[CampaignScorecard]:
        """Fetch campaign scorecards from vw_campaign_diagnostic."""
        if not self.bq_client:
            logger.warning("No BQ client — returning mock data")
            return self._mock_scorecards()

        query = f"""
        SELECT *
        FROM `levelup-465304.{self.config.dataset}.vw_campaign_diagnostic`
        ORDER BY spend DESC
        """

        rows = list(self.bq_client.query(query).result())
        scorecards = []
        for row in rows:
            sc = CampaignScorecard(
                campaign_id=row.campaign_id,
                campaign_name=row.campaign_name or "",
                status=row.status,
                primary_signal=row.primary_signal,
                recommended_action=row.recommended_action,
                targeting_country=row.targeting_country or "",
                creative_type=row.dominant_creative_type or "",
                campaign_age_days=row.campaign_age_days or 0,
                spend=float(row.spend or 0),
                confirmed_roas=float(row.confirmed_roas or 0),
                confirmed_roas_ma7=float(row.confirmed_roas_ma7 or 0),
                ctr=float(row.ctr or 0),
                cpm=float(row.cpm or 0),
                hook_rate=float(row.hook_rate) if row.hook_rate else None,
                frequency=float(row.frequency or 0),
                cost_per_lead=float(row.cost_per_lead or 0),
                lead_to_order_rate=float(row.lead_to_order_rate or 0),
                return_rate=float(row.return_rate or 0),
                roas_momentum=row.roas_momentum or "STABLE",
                vs_avg_ctr=float(row.vs_avg_ctr or 0),
                vs_avg_cpm=float(row.vs_avg_cpm or 0),
                vs_avg_roas=float(row.vs_avg_roas or 0),
            )
            scorecards.append(sc)

        return scorecards

    async def _fetch_funnel_data(self) -> List[FunnelScorecard]:
        """Fetch funnel data from vw_spend_funnel."""
        if not self.bq_client:
            return []

        query = f"""
        SELECT *
        FROM `levelup-465304.{self.config.dataset}.vw_spend_funnel`
        ORDER BY total_spend DESC
        LIMIT 10
        """

        rows = list(self.bq_client.query(query).result())
        funnels = []
        for row in rows:
            fs = FunnelScorecard(
                campaign_id=row.campaign_id,
                campaign_name=row.campaign_name or "",
                impressions=int(row.impressions or 0),
                clicks=int(row.clicks or 0),
                leads=int(row.leads or 0),
                orders=int(row.orders or 0),
                delivered=int(row.delivered or 0),
                returned=int(row.returned or 0),
                stage1_ctr=float(row.stage1_ctr or 0),
                stage2_click_to_lead=float(row.stage2_click_to_lead or 0),
                stage3_lead_to_order=float(row.stage3_lead_to_order or 0),
                stage4_order_to_deliver=float(row.stage4_order_to_deliver or 0),
                return_rate=float(row.return_rate or 0),
                bottleneck_stage=row.bottleneck_stage or "NO_BOTTLENECK",
                confirmed_roas_7d=float(row.confirmed_roas_7d or 0),
            )
            funnels.append(fs)

        return funnels

    # ─── Anomaly Detection ───

    def _detect_anomalies(
        self,
        scorecards: List[CampaignScorecard],
        funnels: List[FunnelScorecard],
    ) -> List[str]:
        """Detect anomalies from scored data."""
        anomalies = []

        for sc in scorecards:
            # High return rate despite good ROAS
            if sc.return_rate > self.config.return_rate_kill and sc.confirmed_roas > 2.0:
                anomalies.append(
                    f"⚠️ {sc.campaign_name}: return_rate {sc.return_rate:.0%} "
                    f"nhưng ROAS {sc.confirmed_roas:.1f} — đơn ảo hoặc quality issue"
                )

            # Phantom revenue
            if (sc.primary_signal == "PHANTOM_REVENUE"):
                anomalies.append(
                    f"🔴 {sc.campaign_name}: provisional >> confirmed ROAS — "
                    f"rủi ro đơn ảo COD"
                )

            # LEARNING but catastrophic top-funnel
            if (sc.status == "LEARNING"
                    and sc.recommended_action == "KILL_EXCEPTION"):
                anomalies.append(
                    f"🚨 {sc.campaign_name}: LEARNING nhưng CTR {sc.ctr:.2%} "
                    f"quá thấp — cân nhắc Kill sớm"
                )

            # Audience saturation
            if sc.primary_signal == "AUDIENCE_SATURATED":
                anomalies.append(
                    f"📊 {sc.campaign_name}: freq {sc.frequency:.1f} — "
                    f"audience saturated, cần refresh creative"
                )

        for fn in funnels:
            if fn.bottleneck_stage == "HIGH_RETURNS":
                anomalies.append(
                    f"📦 {fn.campaign_name}: return_rate {fn.return_rate:.0%} "
                    f"— Kill dù CPL tốt"
                )

        return anomalies

    # ─── Mock Data (for dry-run testing) ───

    @staticmethod
    def _mock_scorecards() -> List[CampaignScorecard]:
        """Return mock scorecards for dry-run / local testing."""
        return [
            CampaignScorecard(
                campaign_id="mock_win_001",
                campaign_name="RO_DRESS_D04_SCALE",
                status="WIN",
                primary_signal="HEALTHY",
                recommended_action="RECOMMEND_SCALE",
                targeting_country="Romania",
                creative_type="VIDEO",
                campaign_age_days=14,
                spend=150.0,
                confirmed_roas=3.5,
                confirmed_roas_ma7=3.2,
                ctr=0.021,
                hook_rate=0.28,
                frequency=1.8,
                cost_per_lead=4.2,
                lead_to_order_rate=0.35,
                return_rate=0.12,
                roas_momentum="UPTREND",
            ),
            CampaignScorecard(
                campaign_id="mock_fail_001",
                campaign_name="BG_JACKET_L20_TEST",
                status="FAIL",
                primary_signal="AUDIENCE_SATURATED",
                recommended_action="RECOMMEND_KILL",
                targeting_country="Bulgaria",
                creative_type="IMAGE",
                campaign_age_days=10,
                spend=100.0,
                confirmed_roas=0.9,
                confirmed_roas_ma7=1.1,
                ctr=0.004,
                hook_rate=0.08,
                frequency=4.2,
                cost_per_lead=12.0,
                lead_to_order_rate=0.15,
                return_rate=0.25,
                roas_momentum="DOWNTREND",
            ),
            CampaignScorecard(
                campaign_id="mock_learn_001",
                campaign_name="RO_COAT_N08_NEW",
                status="LEARNING",
                primary_signal="HEALTHY",
                recommended_action="OBSERVE",
                targeting_country="Romania",
                creative_type="VIDEO",
                campaign_age_days=3,
                spend=50.0,
                confirmed_roas=1.8,
                confirmed_roas_ma7=0.0,
                ctr=0.015,
                hook_rate=0.22,
                frequency=1.2,
                roas_momentum="STABLE",
            ),
        ]
