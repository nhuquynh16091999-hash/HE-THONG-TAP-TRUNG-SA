"""Tests for FAOS Guardian Agent — health check system."""
import pytest
import sys
import os
from datetime import datetime, timedelta
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


class TestGuardianInit:
    """T2.1: Guardian initialization."""

    def test_init_with_projects(self):
        """Should initialize with project IDs."""
        from faos_agents.guardian.agent import GuardianAgent
        agent = GuardianAgent(project_ids=["STRAMARK", "AUUS1"])
        assert agent.project_ids == ["STRAMARK", "AUUS1"]
        assert agent.memory is not None
        assert agent.analyst is not None

    def test_init_default_projects(self):
        """Should default to empty list if no projects given."""
        from faos_agents.guardian.agent import GuardianAgent
        agent = GuardianAgent()
        assert isinstance(agent.project_ids, list)


class TestCheckDataSync:
    """T2.2-T2.4: Data sync checks."""

    def setup_method(self):
        from faos_agents.guardian.agent import GuardianAgent
        self.agent = GuardianAgent(project_ids=["STRAMARK"])

    @patch("faos_agents.guardian.agent.query_bigquery")
    def test_sync_healthy(self, mock_bq):
        """T2.2: Normal orders should return OK."""
        mock_bq.side_effect = [
            "order_count\n-----------\n150",  # yesterday orders
            "avg_orders\n-----------\n130.0",  # 7d avg
        ]
        result = self.agent.check_data_sync("STRAMARK")
        assert result["status"] == "OK"
        assert result["orders_yesterday"] == 150

    @patch("faos_agents.guardian.agent.query_bigquery")
    def test_sync_zero_orders(self, mock_bq):
        """T2.3: Zero orders should ALERT."""
        mock_bq.side_effect = [
            "order_count\n-----------\n0",
            "avg_orders\n-----------\n130.0",
        ]
        result = self.agent.check_data_sync("STRAMARK")
        assert result["status"] == "ALERT"

    @patch("faos_agents.guardian.agent.query_bigquery")
    def test_sync_big_drop(self, mock_bq):
        """T2.4: 60% drop should WARNING."""
        mock_bq.side_effect = [
            "order_count\n-----------\n40",
            "avg_orders\n-----------\n100.0",
        ]
        result = self.agent.check_data_sync("STRAMARK")
        assert result["status"] in ("WARNING", "ALERT")


class TestCheckAdsData:
    """T2.5-T2.6: Ads data checks."""

    def setup_method(self):
        from faos_agents.guardian.agent import GuardianAgent
        self.agent = GuardianAgent(project_ids=["STRAMARK"])

    @patch("faos_agents.guardian.agent.query_bigquery")
    def test_ads_data_exists(self, mock_bq):
        """T2.5: Ads data present should be OK."""
        mock_bq.return_value = "ad_count\n--------\n42"
        result = self.agent.check_ads_data("STRAMARK")
        assert result["status"] == "OK"
        assert result["ads_rows_yesterday"] == 42

    @patch("faos_agents.guardian.agent.query_bigquery")
    def test_ads_data_missing(self, mock_bq):
        """T2.6: No ads data should WARNING."""
        mock_bq.return_value = "ad_count\n--------\n0"
        result = self.agent.check_ads_data("STRAMARK")
        assert result["status"] == "WARNING"


class TestCheckTokenExpiry:
    """T2.7-T2.9: Token expiry checks."""

    def setup_method(self):
        from faos_agents.guardian.agent import GuardianAgent
        self.agent = GuardianAgent(project_ids=["STRAMARK"])

    def test_token_ok(self):
        """T2.7: Token with 56 days remaining should be OK."""
        future = (datetime.now() + timedelta(days=56)).strftime("%Y-%m-%d")
        with patch.dict(
            "faos_agents.guardian.agent.TOKEN_EXPIRY_DATES",
            {"STRAMARK": future},
        ):
            result = self.agent.check_token_expiry("STRAMARK")
        assert result["status"] == "OK"
        assert result["days_remaining"] >= 55

    def test_token_warning(self):
        """T2.8: Token with 12 days remaining should WARNING."""
        future = (datetime.now() + timedelta(days=12)).strftime("%Y-%m-%d")
        with patch.dict(
            "faos_agents.guardian.agent.TOKEN_EXPIRY_DATES",
            {"STRAMARK": future},
        ):
            result = self.agent.check_token_expiry("STRAMARK")
        assert result["status"] == "WARNING"

    def test_token_urgent(self):
        """T2.9: Token with 5 days remaining should URGENT."""
        future = (datetime.now() + timedelta(days=5)).strftime("%Y-%m-%d")
        with patch.dict(
            "faos_agents.guardian.agent.TOKEN_EXPIRY_DATES",
            {"STRAMARK": future},
        ):
            result = self.agent.check_token_expiry("STRAMARK")
        assert result["status"] == "URGENT"


class TestCheckStuckOrders:
    """T2.10-T2.11: Stuck orders checks."""

    def setup_method(self):
        from faos_agents.guardian.agent import GuardianAgent
        self.agent = GuardianAgent(project_ids=["STRAMARK"])

    @patch("faos_agents.guardian.agent.query_bigquery")
    def test_no_stuck_orders(self, mock_bq):
        """T2.10: No stuck orders should be OK."""
        mock_bq.return_value = "Query returned 0 rows."
        result = self.agent.check_stuck_orders("STRAMARK")
        assert result["status"] == "OK"
        assert result["stuck_count"] == 0

    @patch("faos_agents.guardian.agent.query_bigquery")
    def test_has_stuck_orders(self, mock_bq):
        """T2.11: Stuck orders should WARNING."""
        mock_bq.return_value = (
            "order_id | order_status | created_at\n"
            "---\n"
            "ORD-001 | pending | 2026-02-27\n"
            "ORD-002 | pending | 2026-02-26\n"
            "ORD-003 | confirmed | 2026-02-26"
        )
        result = self.agent.check_stuck_orders("STRAMARK")
        assert result["status"] == "WARNING"
        assert result["stuck_count"] == 3


class TestAnomalyDetection:
    """T2.12: Cross-project anomaly detection."""

    def setup_method(self):
        from faos_agents.guardian.agent import GuardianAgent
        self.agent = GuardianAgent(project_ids=["STRAMARK"])

    @patch("faos_agents.guardian.agent.query_bigquery")
    def test_anomaly_detected(self, mock_bq):
        """T2.12: Data with outlier should detect anomaly."""
        # Return 10 days of data with day 9 as outlier
        rows = ["order_date | total_orders", "---"]
        for i in range(10):
            orders = 10 if i == 8 else 100  # day 9 = outlier
            rows.append(f"2026-02-{20+i} | {orders}")
        mock_bq.return_value = "\n".join(rows)
        result = self.agent.check_order_anomalies()
        assert result["has_anomalies"] is True


class TestCompileReport:
    """T2.13: Report formatting."""

    def test_compile_report_format(self):
        """T2.13: Report should contain project names and emojis."""
        from faos_agents.guardian.agent import GuardianAgent
        agent = GuardianAgent(project_ids=["STRAMARK"])

        checks = {
            "data_sync": [{"project": "STRAMARK", "status": "OK", "orders_yesterday": 150, "orders_7d_avg": 130, "detail": "OK"}],
            "ads_data": [{"project": "STRAMARK", "status": "OK", "ads_rows_yesterday": 42, "detail": "42 ads"}],
            "token_expiry": [{"project": "STRAMARK", "status": "OK", "days_remaining": 56, "expires": "2026-04-26", "detail": "OK"}],
            "stuck_orders": [{"project": "STRAMARK", "status": "OK", "stuck_count": 0, "stuck_orders": [], "detail": "OK"}],
            "anomalies": {"has_anomalies": False, "details": []},
        }

        report = agent.compile_report(checks)
        assert "STRAMARK" in report
        assert "Health Check" in report
        assert "✅" in report


class TestFullRun:
    """T2.14: Full dry run."""

    @patch("faos_agents.guardian.agent.query_bigquery")
    @patch("faos_agents.guardian.agent.send_telegram")
    @patch("faos_agents.guardian.agent.send_discord")
    def test_full_run(self, mock_discord, mock_tg, mock_bq):
        """T2.14: Full run should return report string."""
        from faos_agents.guardian.agent import GuardianAgent

        # Mock all BQ queries to return simple data
        mock_bq.return_value = "order_count\n-----------\n100"
        mock_tg.return_value = "✅ Sent"
        mock_discord.return_value = "✅ Sent"

        agent = GuardianAgent(project_ids=["STRAMARK"])
        report = agent.run()

        assert isinstance(report, str)
        assert len(report) > 0
