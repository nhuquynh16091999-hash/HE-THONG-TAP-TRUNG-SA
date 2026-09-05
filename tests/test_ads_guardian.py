"""Tests for FAOS Ads Guardian Agent — real-time ads monitoring."""
import pytest
import sys
import os
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


# ─── Sample campaign data ───

GOOD_CAMPAIGN = {
    "campaign_name": "LED Dress RO", "campaign_id": "c1",
    "spend": 200, "revenue": 800, "orders": 25, "success_orders": 20,
    "impressions": 50000, "clicks": 1500,
}
BAD_CAMPAIGN = {
    "campaign_name": "Old Widget", "campaign_id": "c2",
    "spend": 300, "revenue": 150, "orders": 3, "success_orders": 1,
    "impressions": 40000, "clicks": 200,
}
WARNING_CAMPAIGN = {
    "campaign_name": "Test Ad B", "campaign_id": "c3",
    "spend": 400, "revenue": 600, "orders": 15, "success_orders": 10,
    "impressions": 60000, "clicks": 900,
}

BQ_CAMPAIGN_LIST = (
    "campaign_name | campaign_id | spend | revenue | orders | success_orders | impressions | clicks\n"
    "---\n"
    "LED Dress RO | c1 | 200 | 800 | 25 | 20 | 50000 | 1500\n"
    "Old Widget | c2 | 300 | 150 | 3 | 1 | 40000 | 200\n"
    "Test Ad B | c3 | 400 | 600 | 15 | 10 | 60000 | 900"
)

BQ_DAILY_SPEND = (
    "report_date | daily_spend\n---\n"
    "2026-02-22 | 500\n2026-02-23 | 520\n2026-02-24 | 490\n"
    "2026-02-25 | 510\n2026-02-26 | 530\n2026-02-27 | 500\n"
    "2026-02-28 | 510"
)

BQ_DAILY_SPEND_ANOMALY = (
    "report_date | daily_spend\n---\n"
    "2026-02-22 | 500\n2026-02-23 | 520\n2026-02-24 | 490\n"
    "2026-02-25 | 510\n2026-02-26 | 530\n2026-02-27 | 500\n"
    "2026-02-28 | 2000"  # spike!
)

BQ_EFFICIENCY = (
    "total_spend | total_revenue | total_orders | success_orders\n---\n"
    "12000 | 30000 | 120 | 85"
)

BQ_EFFICIENCY_BAD = (
    "total_spend | total_revenue | total_orders | success_orders\n---\n"
    "15000 | 10000 | 50 | 20"
)


class TestAdsGuardianInit:
    """T4.1: Initialization."""

    def test_init(self):
        from faos_agents.ads_guardian.agent import AdsGuardianAgent
        agent = AdsGuardianAgent(
            project_ids=["STRAMARK", "AUUS1"],
            cpa_targets={"STRAMARK": 18, "AUUS1": 15},
        )
        assert agent.project_ids == ["STRAMARK", "AUUS1"]
        assert agent.cpa_targets["STRAMARK"] == 18


class TestEvaluateCampaign:
    """T4.2-T4.4: Campaign evaluation."""

    def setup_method(self):
        from faos_agents.ads_guardian.agent import AdsGuardianAgent
        self.agent = AdsGuardianAgent(
            project_ids=["STRAMARK"],
            cpa_targets={"STRAMARK": 18},
        )

    def test_good_campaign(self):
        """T4.2: Good ROAS campaign → OK."""
        result = self.agent.evaluate_campaign(GOOD_CAMPAIGN, cpa_target=18)
        assert result["status"] == "OK"

    def test_bad_campaign(self):
        """T4.3: ROAS < 1 → CRITICAL."""
        result = self.agent.evaluate_campaign(BAD_CAMPAIGN, cpa_target=18)
        assert result["status"] == "CRITICAL"

    def test_warning_campaign(self):
        """T4.4: CPA above target → WARNING."""
        result = self.agent.evaluate_campaign(WARNING_CAMPAIGN, cpa_target=18)
        assert result["status"] in ("WARNING", "CRITICAL")


class TestAutoRecommend:
    """T4.5-T4.7: Auto recommendations."""

    def setup_method(self):
        from faos_agents.ads_guardian.agent import AdsGuardianAgent
        self.agent = AdsGuardianAgent(
            project_ids=["STRAMARK"],
            cpa_targets={"STRAMARK": 18},
        )

    def test_critical_recommends_pause(self):
        """T4.5: CRITICAL status → PAUSE."""
        evaluation = {"status": "CRITICAL", "roas": 0.5, "cpa": 100, "spend": 300}
        result = self.agent.auto_recommend_action(evaluation, cpa_target=18, current_budget=500)
        assert result["action"] == "PAUSE"

    def test_ok_profitable_recommends_scale(self):
        """T4.6: OK + profitable → SCALE."""
        evaluation = {"status": "OK", "roas": 4.0, "cpa": 8, "spend": 200}
        result = self.agent.auto_recommend_action(evaluation, cpa_target=18, current_budget=500, days_profitable=5)
        assert result["action"] == "SCALE"

    def test_warning_recommends_reduce(self):
        """T4.7: WARNING with high CPA → REDUCE."""
        evaluation = {"status": "WARNING", "roas": 1.5, "cpa": 30, "spend": 400}
        result = self.agent.auto_recommend_action(evaluation, cpa_target=18, current_budget=500)
        assert result["action"] in ("REDUCE", "HOLD")


class TestBudgetEfficiency:
    """T4.8-T4.9: Budget efficiency check."""

    def setup_method(self):
        from faos_agents.ads_guardian.agent import AdsGuardianAgent
        self.agent = AdsGuardianAgent(
            project_ids=["STRAMARK"],
            cpa_targets={"STRAMARK": 18},
        )

    @patch("faos_agents.ads_guardian.agent.query_bigquery")
    def test_good_efficiency(self, mock_bq):
        """T4.8: Good overall ROAS → OK."""
        mock_bq.return_value = BQ_EFFICIENCY
        result = self.agent.check_budget_efficiency("STRAMARK")
        assert result["status"] == "OK"
        assert result["overall_roas"] >= 2.0

    @patch("faos_agents.ads_guardian.agent.query_bigquery")
    def test_bad_efficiency(self, mock_bq):
        """T4.9: Bad ROAS < 1 → CRITICAL."""
        mock_bq.return_value = BQ_EFFICIENCY_BAD
        result = self.agent.check_budget_efficiency("STRAMARK")
        assert result["status"] in ("WARNING", "CRITICAL")


class TestSpendAnomaly:
    """T4.10-T4.11: Spend anomaly detection."""

    def setup_method(self):
        from faos_agents.ads_guardian.agent import AdsGuardianAgent
        self.agent = AdsGuardianAgent(
            project_ids=["STRAMARK"],
            cpa_targets={"STRAMARK": 18},
        )

    @patch("faos_agents.ads_guardian.agent.query_bigquery")
    def test_normal_spend(self, mock_bq):
        """T4.10: Normal spend pattern → no anomaly."""
        mock_bq.return_value = BQ_DAILY_SPEND
        result = self.agent.detect_spend_anomaly("STRAMARK")
        assert result["has_anomaly"] is False

    @patch("faos_agents.ads_guardian.agent.query_bigquery")
    def test_anomalous_spend(self, mock_bq):
        """T4.11: Spend spike → anomaly detected."""
        mock_bq.return_value = BQ_DAILY_SPEND_ANOMALY
        result = self.agent.detect_spend_anomaly("STRAMARK")
        assert result["has_anomaly"] is True


class TestCompileAlert:
    """T4.12-T4.13: Alert compilation."""

    def setup_method(self):
        from faos_agents.ads_guardian.agent import AdsGuardianAgent
        self.agent = AdsGuardianAgent(
            project_ids=["STRAMARK"],
            cpa_targets={"STRAMARK": 18},
        )

    def test_no_problems_no_alert(self):
        """T4.12: All OK → None (no alert sent)."""
        results = {
            "campaigns": [{"status": "OK", "campaign_name": "Good Ad", "action": "HOLD"}],
            "efficiency": {"status": "OK"},
            "anomaly": {"has_anomaly": False},
        }
        alert = self.agent.compile_alert(results, "STRAMARK")
        assert alert is None

    def test_critical_generates_alert(self):
        """T4.13: CRITICAL campaign → generates alert string."""
        results = {
            "campaigns": [
                {"status": "CRITICAL", "campaign_name": "Old Widget", "action": "PAUSE",
                 "roas": 0.5, "cpa": 100, "recommendation": "PAUSE — ROAS 0.5"},
            ],
            "efficiency": {"status": "OK"},
            "anomaly": {"has_anomaly": False},
        }
        alert = self.agent.compile_alert(results, "STRAMARK")
        assert alert is not None
        assert "Old Widget" in alert
        assert "🔴" in alert


class TestSendAndRun:
    """T4.14-T4.15: Send + full run."""

    def setup_method(self):
        from faos_agents.ads_guardian.agent import AdsGuardianAgent
        self.agent = AdsGuardianAgent(
            project_ids=["STRAMARK"],
            cpa_targets={"STRAMARK": 18},
        )

    @patch("faos_agents.ads_guardian.agent.send_telegram")
    @patch("faos_agents.ads_guardian.agent.send_discord")
    def test_send_alert(self, mock_dc, mock_tg):
        """T4.14: Should send to both channels."""
        mock_tg.return_value = "✅ Sent"
        mock_dc.return_value = "✅ Sent"
        result = self.agent.send_alert("Test alert")
        assert result["telegram"] == "✅ Sent"

    @patch("faos_agents.ads_guardian.agent.query_bigquery")
    @patch("faos_agents.ads_guardian.agent.send_telegram")
    @patch("faos_agents.ads_guardian.agent.send_discord")
    def test_full_run(self, mock_dc, mock_tg, mock_bq):
        """T4.15: Full run should return results string."""
        mock_bq.return_value = BQ_CAMPAIGN_LIST
        mock_tg.return_value = "✅ Sent"
        mock_dc.return_value = "✅ Sent"
        result = self.agent.run()
        assert isinstance(result, str)
        assert len(result) > 0
