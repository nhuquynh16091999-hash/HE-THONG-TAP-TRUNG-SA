"""Tests for FAOS Daily Reporter Agent — executive summary generation."""
import pytest
import sys
import os
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


# ─── Sample BQ responses ───

BQ_DAILY_PNL = (
    "order_date | gross_revenue | total_orders | success_orders | "
    "returned_orders | canceled_orders | shipping_cost | "
    "operating_profit | operating_margin_pct | avg_order_value | success_rate\n"
    "---\n"
    "2026-02-28 | 30000 | 120 | 85 | 15 | 20 | 4000 | 8000 | 0.267 | 250 | 0.708"
)

BQ_DAILY_PNL_PREV = (
    "order_date | gross_revenue | total_orders | success_orders | "
    "returned_orders | canceled_orders | shipping_cost | "
    "operating_profit | operating_margin_pct | avg_order_value | success_rate\n"
    "---\n"
    "2026-02-27 | 27000 | 110 | 78 | 12 | 20 | 3800 | 7000 | 0.259 | 245 | 0.709"
)

BQ_TOP_ADS = (
    "ads_id | ad_name | roas_success | total_spend | total_orders | success_orders | cost_per_order\n"
    "---\n"
    "a1 | LED Dress RO | 4.2 | 200 | 25 | 20 | 8\n"
    "a2 | Serum Anti-Age | 3.5 | 350 | 30 | 22 | 12\n"
    "a3 | Vitamin C Pack | 3.1 | 180 | 15 | 12 | 12"
)

BQ_BOTTOM_ADS = (
    "ads_id | ad_name | roas_success | total_spend | total_orders | success_orders | cost_per_order\n"
    "---\n"
    "a10 | Old Widget | 0.5 | 300 | 3 | 1 | 100\n"
    "a11 | Test Ad 2 | 0.8 | 150 | 5 | 2 | 30\n"
    "a12 | Bad Creative | 1.0 | 200 | 8 | 4 | 25"
)

BQ_WEEKLY_THIS = (
    "period | revenue | orders | ad_spend | profit\n---\n"
    "this_week | 200000 | 800 | 80000 | 50000"
)
BQ_WEEKLY_LAST = (
    "period | revenue | orders | ad_spend | profit\n---\n"
    "last_week | 185000 | 750 | 75000 | 45000"
)

BQ_ZERO = "Query returned 0 rows."


class TestReporterInit:
    """T3.1: Reporter initialization."""

    def test_init_with_projects(self):
        from faos_agents.reporter.agent import ReporterAgent
        agent = ReporterAgent(project_ids=["STRAMARK", "AUUS1"])
        assert agent.project_ids == ["STRAMARK", "AUUS1"]
        assert agent.marketing is not None
        assert agent.financial is not None
        assert agent.analyst is not None
        assert agent.memory is not None


class TestFetchDailySummary:
    """T3.2-T3.3: Fetch daily P&L summary."""

    def setup_method(self):
        from faos_agents.reporter.agent import ReporterAgent
        self.agent = ReporterAgent(project_ids=["STRAMARK"])

    @patch("faos_agents.reporter.agent.query_bigquery")
    def test_fetch_daily_summary(self, mock_bq):
        """T3.2: Should parse BQ result into dict with key metrics."""
        mock_bq.side_effect = [BQ_DAILY_PNL, BQ_DAILY_PNL_PREV]
        result = self.agent.fetch_daily_summary("STRAMARK")
        assert result["revenue"] == 30000
        assert result["orders"] == 120
        assert result["success_orders"] == 85
        assert result["profit"] == 8000

    @patch("faos_agents.reporter.agent.query_bigquery")
    def test_fetch_daily_summary_zero(self, mock_bq):
        """T3.3: Zero data should return zeros."""
        mock_bq.return_value = BQ_ZERO
        result = self.agent.fetch_daily_summary("STRAMARK")
        assert result["revenue"] == 0
        assert result["orders"] == 0


class TestFetchAdsPerformance:
    """T3.4: Fetch ads top/bottom."""

    def setup_method(self):
        from faos_agents.reporter.agent import ReporterAgent
        self.agent = ReporterAgent(project_ids=["STRAMARK"])

    @patch("faos_agents.reporter.agent.query_bigquery")
    def test_fetch_ads(self, mock_bq):
        """T3.4: Should return top and bottom ads lists."""
        mock_bq.side_effect = [BQ_TOP_ADS, BQ_BOTTOM_ADS]
        result = self.agent.fetch_ads_performance("STRAMARK")
        assert len(result["top_ads"]) == 3
        assert len(result["bottom_ads"]) == 3
        assert result["top_ads"][0]["roas"] >= result["top_ads"][-1]["roas"]


class TestFetchWeeklyComparison:
    """T3.5: Weekly comparison."""

    def setup_method(self):
        from faos_agents.reporter.agent import ReporterAgent
        self.agent = ReporterAgent(project_ids=["STRAMARK"])

    @patch("faos_agents.reporter.agent.query_bigquery")
    def test_weekly_comparison(self, mock_bq):
        """T3.5: Should calculate change percentages."""
        mock_bq.side_effect = [BQ_WEEKLY_THIS, BQ_WEEKLY_LAST]
        result = self.agent.fetch_weekly_comparison("STRAMARK")
        assert "changes" in result
        assert result["changes"]["revenue_change_pct"] > 0  # 200k vs 185k = +8%


class TestSections:
    """T3.6-T3.10: Report sections."""

    def setup_method(self):
        from faos_agents.reporter.agent import ReporterAgent
        self.agent = ReporterAgent(project_ids=["STRAMARK"])
        self.summary = {
            "STRAMARK": {
                "revenue": 30000, "orders": 120, "success_orders": 85,
                "returned_orders": 15, "canceled_orders": 20,
                "shipping_cost": 4000, "profit": 8000, "margin_pct": 26.7,
                "avg_order_value": 250, "success_rate": 70.8, "ad_spend": 12000,
                "roas": 2.5, "revenue_prev": 27000,
            }
        }
        self.ads = {
            "STRAMARK": {
                "top_ads": [
                    {"name": "LED Dress", "roas": 4.2, "spend": 200, "orders": 25, "success_orders": 20, "cpa": 8},
                    {"name": "Serum", "roas": 3.5, "spend": 350, "orders": 30, "success_orders": 22, "cpa": 12},
                ],
                "bottom_ads": [
                    {"name": "Old Widget", "roas": 0.5, "spend": 300, "orders": 3, "success_orders": 1, "cpa": 100},
                    {"name": "Bad Creative", "roas": 0.8, "spend": 150, "orders": 5, "success_orders": 2, "cpa": 30},
                ],
                "overall_roas": 2.5, "total_spend": 12000,
            }
        }
        self.weekly = {
            "STRAMARK": {
                "current": {"revenue": 200000, "profit": 50000, "orders": 800, "ad_spend": 80000},
                "previous": {"revenue": 185000, "profit": 45000, "orders": 750, "ad_spend": 75000},
                "changes": {"revenue_change_pct": 8.1, "profit_change_pct": 11.1, "orders_change_pct": 6.7, "ad_spend_change_pct": 6.7},
                "interpretation": "📈 Tăng trưởng healthy",
            }
        }

    def test_section_overview(self):
        """T3.6: Overview should contain key metrics."""
        result = self.agent.section_overview(self.summary)
        assert "30,000" in result or "30000" in result
        assert "120" in result

    def test_section_per_project(self):
        """T3.7: Per-project should contain project name and flag."""
        result = self.agent.section_per_project(self.summary)
        assert "STRAMARK" in result

    def test_section_top_bottom_ads(self):
        """T3.8: Should show top + bottom ads."""
        result = self.agent.section_top_bottom_ads(self.ads)
        assert "LED Dress" in result or "Top" in result
        assert "Old Widget" in result or "Bottom" in result

    def test_section_actions(self):
        """T3.9: Should generate action items."""
        result = self.agent.section_actions(self.summary, self.ads)
        assert isinstance(result, str)
        assert len(result) > 0

    def test_section_weekly(self):
        """T3.10: Should show trend."""
        result = self.agent.section_weekly_comparison(self.weekly)
        assert "%" in result


class TestCompileAndSend:
    """T3.11-T3.12: Compile and send."""

    def setup_method(self):
        from faos_agents.reporter.agent import ReporterAgent
        self.agent = ReporterAgent(project_ids=["STRAMARK"])

    def test_compile_report(self):
        """T3.11: Should compile sections into single string."""
        sections = ["Section 1 content", "Section 2 content", "Section 3 content"]
        result = self.agent.compile_report(sections)
        assert "BÁO CÁO SÁNG" in result
        assert "Section 1" in result
        assert "Section 2" in result

    @patch("faos_agents.reporter.agent.send_telegram")
    @patch("faos_agents.reporter.agent.send_discord")
    def test_send_report(self, mock_discord, mock_tg):
        """T3.12: Should send via Telegram + Discord."""
        mock_tg.return_value = "✅ Sent"
        mock_discord.return_value = "✅ Sent"
        result = self.agent.send_report("Test report")
        assert "telegram" in result
        assert "discord" in result


class TestFullRun:
    """T3.13: Full dry run."""

    @patch("faos_agents.reporter.agent.query_bigquery")
    @patch("faos_agents.reporter.agent.send_telegram")
    @patch("faos_agents.reporter.agent.send_discord")
    def test_full_run(self, mock_discord, mock_tg, mock_bq):
        """T3.13: Full run should return report string."""
        from faos_agents.reporter.agent import ReporterAgent

        mock_bq.return_value = BQ_DAILY_PNL
        mock_tg.return_value = "✅ Sent"
        mock_discord.return_value = "✅ Sent"

        agent = ReporterAgent(project_ids=["STRAMARK"])
        report = agent.run()
        assert isinstance(report, str)
        assert len(report) > 50


class TestMemory:
    """T3.14: Memory save."""

    def test_save_to_memory(self):
        """T3.14: Should return confirmation string."""
        from faos_agents.reporter.agent import ReporterAgent
        agent = ReporterAgent(project_ids=["STRAMARK"])
        result = agent.save_to_memory("Test report", {"key": "val"})
        assert isinstance(result, str)
