"""Tests for the Ads Optimization Intelligence module."""

import pytest
from datetime import date
from unittest.mock import AsyncMock, MagicMock

from faos_brain.optimization.config import (
    ExecutionMode,
    OptimizationConfig,
    SyncTier,
    get_project_config,
)
from faos_brain.optimization.diagnostic import (
    CampaignDiagnostic,
    CampaignScorecard,
    DiagnosticReport,
    FunnelScorecard,
)
from faos_brain.optimization.funnel import FunnelAnalyzer, FunnelReport
from faos_brain.optimization.pattern_engine import Pattern, PatternEngine
from faos_brain.optimization.reporter import OptimizationReporter


# ═══════════════════════════════════════════════════════════════════
# Config Tests
# ═══════════════════════════════════════════════════════════════════

class TestOptimizationConfig:
    """Test per-project configuration."""

    def test_get_stramark_config(self) -> None:
        """STRAMARK config loads with correct defaults."""
        config = get_project_config("stramark")
        assert config.project_id == "stramark"
        assert config.dataset == "STRAMARK_Dataset"
        assert config.roas_target == 2.5
        assert config.roas_danger == 1.3
        assert config.execution_mode == ExecutionMode.RECOMMEND_ONLY

    def test_get_unknown_project_raises(self) -> None:
        """Unknown project raises KeyError."""
        with pytest.raises(KeyError, match="No optimization config"):
            get_project_config("nonexistent")

    def test_config_case_insensitive(self) -> None:
        """Project ID lookup is case-insensitive."""
        config = get_project_config("STRAMARK")
        assert config.project_id == "stramark"

    def test_default_thresholds(self) -> None:
        """Default thresholds match operational rules."""
        config = get_project_config("stramark")
        assert config.hook_rate_min == 0.15
        assert config.frequency_saturated == 3.0
        assert config.campaign_learning_days == 7
        assert config.slope_is_warning_only is True
        assert config.max_budget_change_pct == 0.20

    def test_smart_sync_intervals(self) -> None:
        """Smart sync intervals match tiered spec."""
        config = get_project_config("stramark")
        assert config.sync_hot_interval == 30
        assert config.sync_warm_interval == 180
        assert config.sync_cold_interval == 1440

    def test_execution_mode_enum(self) -> None:
        """ExecutionMode enum has correct values."""
        assert ExecutionMode.RECOMMEND_ONLY.value == "recommend_only"
        assert ExecutionMode.SUPERVISED.value == "supervised"

    def test_sync_tier_enum(self) -> None:
        """SyncTier enum has all tiers."""
        assert SyncTier.HOT.value == "hot"
        assert SyncTier.WARM.value == "warm"
        assert SyncTier.COLD.value == "cold"
        assert SyncTier.ONCE.value == "once"


# ═══════════════════════════════════════════════════════════════════
# Diagnostic Tests
# ═══════════════════════════════════════════════════════════════════

class TestCampaignDiagnostic:
    """Test campaign diagnostic engine."""

    @pytest.mark.asyncio
    async def test_run_without_bq_returns_mock_data(self) -> None:
        """Diagnostic runs with mock data when no BQ client."""
        diag = CampaignDiagnostic(
            project_id="stramark",
            run_date=date(2026, 3, 7),
        )
        report = await diag.run()

        assert isinstance(report, DiagnosticReport)
        assert report.project_id == "stramark"
        assert report.execution_mode == "recommend_only"
        assert report.has_data
        assert len(report.top_wins) > 0
        assert len(report.top_fails) > 0

    @pytest.mark.asyncio
    async def test_learning_campaign_classified_correctly(self) -> None:
        """Campaigns < 7 days get LEARNING status."""
        diag = CampaignDiagnostic(project_id="stramark")
        report = await diag.run()

        learning = report.learning_campaigns
        for sc in learning:
            assert sc.status == "LEARNING"
            assert sc.campaign_age_days < 7

    @pytest.mark.asyncio
    async def test_anomaly_detection_phantom_revenue(self) -> None:
        """Phantom revenue triggers anomaly."""
        diag = CampaignDiagnostic(project_id="stramark")
        scorecards = [
            CampaignScorecard(
                campaign_id="test",
                campaign_name="TEST_PHANTOM",
                status="OKAY",
                primary_signal="PHANTOM_REVENUE",
                recommended_action="MONITOR",
                confirmed_roas=1.5,
                return_rate=0.1,
            ),
        ]
        anomalies = diag._detect_anomalies(scorecards, [])
        assert any("PHANTOM" in a or "ảo" in a for a in anomalies)

    @pytest.mark.asyncio
    async def test_anomaly_detection_high_returns(self) -> None:
        """High return rate despite good ROAS triggers anomaly."""
        diag = CampaignDiagnostic(project_id="stramark")
        scorecards = [
            CampaignScorecard(
                campaign_id="test",
                campaign_name="TEST_RETURNS",
                status="OKAY",
                primary_signal="HEALTHY",
                recommended_action="MONITOR",
                confirmed_roas=2.5,
                return_rate=0.45,
            ),
        ]
        anomalies = diag._detect_anomalies(scorecards, [])
        assert len(anomalies) > 0
        assert any("return" in a.lower() for a in anomalies)


# ═══════════════════════════════════════════════════════════════════
# Funnel Tests
# ═══════════════════════════════════════════════════════════════════

class TestFunnelAnalyzer:
    """Test funnel analysis."""

    @pytest.mark.asyncio
    async def test_analyze_with_funnels(self) -> None:
        """Funnel analysis works with provided data."""
        analyzer = FunnelAnalyzer(project_id="stramark")
        funnels = [
            FunnelScorecard(
                campaign_id="test1",
                campaign_name="TEST",
                impressions=10000,
                clicks=120,
                leads=45,
                orders=12,
                delivered=9,
                returned=3,
                stage1_ctr=0.012,
                stage3_lead_to_order=0.267,
                stage4_order_to_deliver=0.75,
                return_rate=0.25,
                bottleneck_stage="NO_BOTTLENECK",
            ),
        ]
        report = await analyzer.analyze(funnels=funnels)

        assert isinstance(report, FunnelReport)
        assert report.total_impressions == 10000
        assert report.total_clicks == 120
        assert report.overall_ctr == pytest.approx(0.012, abs=0.001)

    @pytest.mark.asyncio
    async def test_high_return_campaigns_detected(self) -> None:
        """Campaigns with return_rate > kill threshold detected."""
        config = get_project_config("stramark")
        analyzer = FunnelAnalyzer(project_id="stramark", config=config)
        funnels = [
            FunnelScorecard(
                campaign_id="high_return",
                campaign_name="HIGH_RETURN_CAMP",
                orders=100,
                delivered=50,
                returned=50,
                return_rate=0.50,
                bottleneck_stage="HIGH_RETURNS",
            ),
        ]
        report = await analyzer.analyze(funnels=funnels)
        assert len(report.high_return_campaigns) == 1
        assert report.high_return_campaigns[0].campaign_id == "high_return"


# ═══════════════════════════════════════════════════════════════════
# Reporter Tests
# ═══════════════════════════════════════════════════════════════════

class TestReporter:
    """Test report formatting."""

    def test_format_diagnostic_section(self) -> None:
        """Diagnostic section formats correctly."""
        reporter = OptimizationReporter()
        report = DiagnosticReport(
            project_id="stramark",
            report_date=date(2026, 3, 7),
            execution_mode="recommend_only",
            total_campaigns=5,
            total_spend=500.0,
            top_wins=[
                CampaignScorecard(
                    campaign_id="w1",
                    campaign_name="WIN_CAMP",
                    status="WIN",
                    primary_signal="HEALTHY",
                    recommended_action="RECOMMEND_SCALE",
                    confirmed_roas_ma7=3.5,
                    ctr=0.021,
                    hook_rate=0.28,
                    frequency=1.8,
                    roas_momentum="UPTREND",
                ),
            ],
            top_fails=[
                CampaignScorecard(
                    campaign_id="f1",
                    campaign_name="FAIL_CAMP",
                    status="FAIL",
                    primary_signal="AUDIENCE_SATURATED",
                    recommended_action="RECOMMEND_KILL",
                    confirmed_roas_ma7=0.9,
                    ctr=0.004,
                    frequency=4.2,
                    roas_momentum="DOWNTREND",
                ),
            ],
        )

        output = reporter.format_diagnostic_section(report)

        assert "CAMPAIGN DIAGNOSTIC" in output
        assert "WIN_CAMP" in output
        assert "FAIL_CAMP" in output
        assert "RECOMMEND_ONLY" in output.upper()
        assert "AUDIENCE_SATURATED" in output

    def test_format_empty_report(self) -> None:
        """Empty report handled gracefully."""
        reporter = OptimizationReporter()
        report = DiagnosticReport(
            project_id="stramark",
            report_date=date(2026, 3, 7),
            execution_mode="recommend_only",
        )
        output = reporter.format_diagnostic_section(report)
        assert "Không có dữ liệu" in output

    def test_summary_stats(self) -> None:
        """Summary stats one-liner works."""
        reporter = OptimizationReporter()
        report = DiagnosticReport(
            project_id="stramark",
            report_date=date(2026, 3, 7),
            execution_mode="recommend_only",
            top_wins=[CampaignScorecard(
                campaign_id="w", campaign_name="W", status="WIN",
                primary_signal="HEALTHY", recommended_action="MONITOR",
            )],
            anomalies=["test anomaly"],
        )
        summary = reporter.format_summary_stats(report)
        assert "1 WIN" in summary
        assert "1 anomalies" in summary


# ═══════════════════════════════════════════════════════════════════
# Pattern Engine Tests
# ═══════════════════════════════════════════════════════════════════

class TestPatternEngine:
    """Test pattern extraction and validation."""

    @pytest.mark.asyncio
    async def test_extract_patterns_from_wins(self) -> None:
        """Patterns extracted from winning campaigns."""
        engine = PatternEngine(project_id="stramark")
        diagnostic = DiagnosticReport(
            project_id="stramark",
            report_date=date(2026, 3, 7),
            execution_mode="recommend_only",
            top_wins=[
                CampaignScorecard(
                    campaign_id="win1",
                    campaign_name="RO_VIDEO_WIN",
                    status="WIN",
                    primary_signal="HEALTHY",
                    recommended_action="RECOMMEND_SCALE",
                    creative_type="VIDEO",
                    targeting_country="Romania",
                    hook_rate=0.30,
                    confirmed_roas_ma7=3.5,
                ),
            ],
            top_fails=[],
        )

        patterns = await engine.extract_patterns(diagnostic)
        assert len(patterns) > 0
        # Should have creative+market pattern and hook_rate pattern
        types = [p.pattern_type for p in patterns]
        assert "CREATIVE" in types

    @pytest.mark.asyncio
    async def test_mock_patterns_returned_without_bq(self) -> None:
        """Mock patterns returned when no BQ client."""
        engine = PatternEngine(project_id="stramark")
        patterns = await engine.get_relevant_patterns()
        assert len(patterns) > 0
        assert all(p.validated for p in patterns)
