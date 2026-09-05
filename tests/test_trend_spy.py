"""Tests for FAOS Trend Spy Agent — product trend analysis."""
import pytest
import sys
import os
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


# ─── Sample products ───

WINNING_PRODUCT = {
    "name": "LED Face Mask Pro",
    "daily_orders": 250,
    "num_advertisers": 5,
    "avg_price": 45.0,
    "age_days": 7,
    "countries": ["RO", "US", "AU"],
    "category": "skincare",
}
WEAK_PRODUCT = {
    "name": "Old Widget X",
    "daily_orders": 10,
    "num_advertisers": 80,
    "avg_price": 120.0,
    "age_days": 90,
    "countries": ["RO"],
    "category": "gadget",
}
GROWTH_PRODUCT = {
    "name": "Serum Anti-Age",
    "daily_orders": 120,
    "num_advertisers": 20,
    "avg_price": 35.0,
    "age_days": 20,
    "countries": ["RO", "US"],
    "category": "skincare",
}

BQ_PRODUCT_DATA = (
    "product_name | total_orders | avg_price | category | success_orders\n"
    "---\n"
    "LED Face Mask Pro | 250 | 45 | skincare | 200\n"
    "Old Widget X | 10 | 120 | gadget | 5\n"
    "Serum Anti-Age | 120 | 35 | skincare | 90"
)

BQ_CATEGORY_DATA = (
    "category | total_revenue | total_orders | avg_roas | product_count\n"
    "---\n"
    "skincare | 50000 | 370 | 2.8 | 8\n"
    "gadget | 3000 | 10 | 0.5 | 2\n"
    "beauty | 25000 | 150 | 2.2 | 5"
)


class TestTrendSpyInit:
    """T5.1: Initialization."""

    def test_init(self):
        from faos_agents.trend_spy.agent import TrendSpyAgent
        agent = TrendSpyAgent(project_ids=["STRAMARK", "AUUS1"])
        assert agent.project_ids == ["STRAMARK", "AUUS1"]
        assert agent.trend is not None
        assert agent.memory is not None


class TestScoreProducts:
    """T5.2-T5.4: Product scoring."""

    def setup_method(self):
        from faos_agents.trend_spy.agent import TrendSpyAgent
        self.agent = TrendSpyAgent(project_ids=["STRAMARK"])

    def test_winning_product_grade_a(self):
        """T5.2: Winning product → grade A, score ≥ 80."""
        results = self.agent.score_products([WINNING_PRODUCT])
        assert len(results) == 1
        assert results[0]["grade"] == "A"
        assert results[0]["score"] >= 80

    def test_weak_product_grade_d(self):
        """T5.3: Weak product → grade D, score < 40."""
        results = self.agent.score_products([WEAK_PRODUCT])
        assert results[0]["grade"] == "D"
        assert results[0]["score"] < 40

    def test_growth_product_grade_b(self):
        """T5.4: Growth product → grade B or C."""
        results = self.agent.score_products([GROWTH_PRODUCT])
        assert results[0]["grade"] in ("B", "C")


class TestSaturatedDetection:
    """T5.5-T5.6: Saturated product identification."""

    def setup_method(self):
        from faos_agents.trend_spy.agent import TrendSpyAgent
        self.agent = TrendSpyAgent(project_ids=["STRAMARK"])

    def test_finds_saturated(self):
        """T5.5: Product with >50 advertisers → saturated."""
        scored = self.agent.score_products([WEAK_PRODUCT])
        saturated = self.agent.detect_saturated_products(scored)
        assert len(saturated) == 1
        assert saturated[0]["name"] == "Old Widget X"

    def test_no_saturated(self):
        """T5.6: Product with <50 advertisers → not saturated."""
        scored = self.agent.score_products([WINNING_PRODUCT])
        saturated = self.agent.detect_saturated_products(scored)
        assert len(saturated) == 0


class TestGrowthOpportunities:
    """T5.7-T5.8: Growth opportunity finding."""

    def setup_method(self):
        from faos_agents.trend_spy.agent import TrendSpyAgent
        self.agent = TrendSpyAgent(project_ids=["STRAMARK"])

    def test_finds_growth(self):
        """T5.7: High score + Launch/Growth stage → opportunity."""
        scored = self.agent.score_products([WINNING_PRODUCT])
        opportunities = self.agent.find_growth_opportunities(scored)
        assert len(opportunities) >= 1

    def test_no_growth(self):
        """T5.8: Low score → no opportunity."""
        scored = self.agent.score_products([WEAK_PRODUCT])
        opportunities = self.agent.find_growth_opportunities(scored)
        assert len(opportunities) == 0


class TestCategoryTrends:
    """T5.9: Category analysis."""

    def setup_method(self):
        from faos_agents.trend_spy.agent import TrendSpyAgent
        self.agent = TrendSpyAgent(project_ids=["STRAMARK"])

    @patch("faos_agents.trend_spy.agent.query_bigquery")
    def test_category_ranking(self, mock_bq):
        """T5.9: Should rank categories by revenue."""
        mock_bq.return_value = BQ_CATEGORY_DATA
        result = self.agent.analyze_category_trends("STRAMARK")
        assert "categories" in result
        assert len(result["categories"]) == 3
        # Top category should be skincare (50k revenue)
        assert result["categories"][0]["category"] == "skincare"


class TestCompileFindings:
    """T5.10-T5.11: Findings compilation."""

    def setup_method(self):
        from faos_agents.trend_spy.agent import TrendSpyAgent
        self.agent = TrendSpyAgent(project_ids=["STRAMARK"])

    def test_has_alerts(self):
        """T5.10: Saturated + growth → generates findings string."""
        findings = {
            "saturated": [{"name": "Old Widget", "lifecycle_stage": "Decline", "num_advertisers": 80}],
            "growth": [{"name": "LED Mask", "score": 90, "grade": "A"}],
            "categories": [],
        }
        result = self.agent.compile_findings(findings)
        assert result is not None
        assert "Old Widget" in result

    def test_no_alerts(self):
        """T5.11: No issues → None."""
        findings = {"saturated": [], "growth": [], "categories": []}
        result = self.agent.compile_findings(findings)
        assert result is None


class TestWeeklyReport:
    """T5.12: Weekly report."""

    def test_weekly_report_format(self):
        """T5.12: Weekly report should contain header + sections."""
        from faos_agents.trend_spy.agent import TrendSpyAgent
        agent = TrendSpyAgent(project_ids=["STRAMARK"])
        data = {
            "STRAMARK": {
                "scored": [
                    {"name": "LED Mask", "score": 90, "grade": "A", "lifecycle_stage": "Launch",
                     "recommendation": "🟢 TEST NOW", "pros": ["High demand"], "cons": []},
                ],
                "saturated": [],
                "growth": [{"name": "LED Mask", "score": 90, "grade": "A"}],
                "categories": {"categories": [{"category": "skincare", "total_revenue": 50000, "avg_roas": 2.8}]},
            }
        }
        report = agent.generate_weekly_report(data)
        assert "TREND REPORT" in report or "BÁO CÁO" in report
        assert "LED Mask" in report


class TestSendAndRun:
    """T5.13-T5.14: Send + full run."""

    def setup_method(self):
        from faos_agents.trend_spy.agent import TrendSpyAgent
        self.agent = TrendSpyAgent(project_ids=["STRAMARK"])

    @patch("faos_agents.trend_spy.agent.send_discord")
    def test_send_findings(self, mock_dc):
        """T5.13: Should send to Discord."""
        mock_dc.return_value = "✅ Sent"
        result = self.agent.send_findings("Test findings")
        assert result["discord"] == "✅ Sent"

    @patch("faos_agents.trend_spy.agent.query_bigquery")
    @patch("faos_agents.trend_spy.agent.send_discord")
    def test_full_run(self, mock_dc, mock_bq):
        """T5.14: Full run should return summary string."""
        mock_bq.return_value = BQ_PRODUCT_DATA
        mock_dc.return_value = "✅ Sent"
        result = self.agent.run()
        assert isinstance(result, str)
        assert len(result) > 0
