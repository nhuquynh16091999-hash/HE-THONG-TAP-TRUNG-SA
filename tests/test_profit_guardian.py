"""
💰 Unit Tests for ProfitGuardian (A10 CFO Agent)

Tests analyze() logic with mock BigQuery data.
Does NOT touch BigQuery or any external service.
"""
import unittest
import sys, os
from types import SimpleNamespace

# Setup path
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

# ─── MOCK DEPENDENCIES TO AVOID IMPORT ERRORS ───
from unittest.mock import MagicMock
sys.modules["google"] = MagicMock()
sys.modules["google.cloud"] = MagicMock()
sys.modules["google.cloud.bigquery"] = MagicMock()
sys.modules["tools.bq_client"] = MagicMock()


def make_campaign(name="Test Campaign", spend=100, roas=0.5, orders=2, campaign_id="c1"):
    """Create a mock campaign row (simulates BQ Row)."""
    return SimpleNamespace(
        campaign_id=campaign_id,
        campaign_name=name,
        account_id="act_123",
        spend=spend,
        revenue=spend * roas,
        orders=orders,
        roas=roas,
        cost_per_order=spend / max(orders, 1),
    )


def make_pnl(date="2026-02-15", gross_rev=1000, gross_profit=200, gross_margin=20, return_rate=5):
    """Create a mock P&L row."""
    return SimpleNamespace(
        date=date,
        total_orders=50,
        delivered=45,
        returned=5,
        gross_rev=gross_rev,
        collected_rev=gross_rev * 0.9,
        ads_spend=300,
        shipping=50,
        cogs=100,
        gross_profit=gross_profit,
        return_rate=return_rate,
        gross_margin=gross_margin,
    )


def make_marketer(name="MKT1", spend=500, roas=2.0):
    """Create a mock marketer row."""
    return SimpleNamespace(
        mkter="mkt1",
        marketer_name=name,
        spend=spend,
        rev=spend * roas,
        orders=25,
        returned=2,
        roas=roas,
    )


class TestProfitGuardianAnalyze(unittest.TestCase):
    """Test ProfitGuardian.analyze() logic without BigQuery."""

    class MockMemory:
        def __init__(self):
            self.decisions = []
            self.recalls = []
            self.alerts = []

        def log_decision(self, entity_id, decision, reason, context=None):
            self.decisions.append({
                "entity_id": entity_id,
                "decision": decision,
                "reason": reason,
                "context": context
            })

        def recall_similar(self, query, top_k=1):
            self.recalls.append(query)
            return [{"decision": "TEST_DECISION", "distance": 0.1}]
            
        def publish_alert(self, alert_type, payload):
            self.alerts.append({"type": alert_type, "payload": payload})

    def _get_agent_class(self):
        """Import ProfitGuardian class."""
        from agents.profit_guardian import ProfitGuardian
        return ProfitGuardian

    def _create_agent(self):
        """Create agent instance with mock BQ (skip real BQ connection)."""
        PG = self._get_agent_class()
        # Trick: create instance but skip __init__ BigQuery connection
        agent = object.__new__(PG)
        agent.project_id = "test"
        agent.days = 7
        agent.dry_run = True
        agent.memory = self.MockMemory()  # Inject Mock Memory
        agent.log = type('MockLog', (), {
            'info': lambda self, msg: None,
            'warning': lambda self, msg: None,
            'error': lambda self, msg: None,
        })()
        agent._data_dir = os.path.join(os.path.dirname(__file__), '.test_data')
        os.makedirs(agent._data_dir, exist_ok=True)
        return agent

    # ─── ROAS Tests ───────────────────────────────────────

    def test_danger_roas_creates_critical_alert(self):
        """Campaign with ROAS < 1.2 (danger) should generate CRITICAL alert."""
        agent = self._create_agent()
        data = {
            "campaigns": [make_campaign(roas=0.5, spend=100)],
            "marketers": [],
            "pnl": [make_pnl(gross_margin=25)],
        }
        alerts = agent.analyze(data)
        roas_alerts = [a for a in alerts if a.get("type") == "roas"]
        self.assertTrue(len(roas_alerts) >= 1)
        self.assertEqual(roas_alerts[0]["level"], "CRITICAL")

    def test_warning_roas_creates_warning_alert(self):
        """Campaign with ROAS between 1.2-1.8 should generate WARNING alert."""
        agent = self._create_agent()
        data = {
            "campaigns": [make_campaign(roas=1.5, spend=100)],
            "marketers": [],
            "pnl": [make_pnl(gross_margin=25)],
        }
        alerts = agent.analyze(data)
        roas_alerts = [a for a in alerts if a.get("type") == "roas"]
        self.assertTrue(len(roas_alerts) >= 1)
        self.assertEqual(roas_alerts[0]["level"], "WARNING")

    def test_good_roas_no_alert(self):
        """Campaign with ROAS >= 1.8 should NOT generate alert."""
        agent = self._create_agent()
        data = {
            "campaigns": [make_campaign(roas=2.5, spend=100)],
            "marketers": [],
            "pnl": [make_pnl(gross_margin=25)],
        }
        alerts = agent.analyze(data)
        roas_alerts = [a for a in alerts if a.get("type") == "roas"]
        self.assertEqual(len(roas_alerts), 0)

    def test_zero_roas_is_critical(self):
        """Campaign with ROAS = 0 (zero sales) should be CRITICAL."""
        agent = self._create_agent()
        data = {
            "campaigns": [make_campaign(roas=0.0, spend=200)],
            "marketers": [],
            "pnl": [make_pnl(gross_margin=25)],
        }
        alerts = agent.analyze(data)
        roas_alerts = [a for a in alerts if a.get("type") == "roas"]
        self.assertTrue(len(roas_alerts) >= 1)
        self.assertEqual(roas_alerts[0]["level"], "CRITICAL")
        
        # Verify memory logging (Lesson 7)
        decisions = agent.memory.decisions
        self.assertTrue(len(decisions) >= 1)
        self.assertTrue(any(d["decision"] == "ROAS_DANGER" for d in decisions))
    # ─── P&L / Margin Tests ───────────────────────────────

    def test_danger_margin_creates_critical_alert(self):
        """Margin < 10% should generate CRITICAL P&L alert."""
        agent = self._create_agent()
        data = {
            "campaigns": [],
            "marketers": [],
            "pnl": [make_pnl(gross_margin=5, gross_profit=50)],
        }
        alerts = agent.analyze(data)
        margin_alerts = [a for a in alerts if a.get("type") == "margin"]
        self.assertTrue(len(margin_alerts) >= 1)
        self.assertEqual(margin_alerts[0]["level"], "CRITICAL")

    def test_warning_margin(self):
        """Margin 10-20% should generate WARNING P&L alert."""
        agent = self._create_agent()
        data = {
            "campaigns": [],
            "marketers": [],
            "pnl": [make_pnl(gross_margin=15, gross_profit=150)],
        }
        alerts = agent.analyze(data)
        margin_alerts = [a for a in alerts if a.get("type") == "margin"]
        self.assertTrue(len(margin_alerts) >= 1)
        self.assertEqual(margin_alerts[0]["level"], "WARNING")

        # Verify memory logging
        decisions = agent.memory.decisions
        self.assertTrue(any(d["decision"] == "PNL_CHECK" for d in decisions))

    def test_healthy_margin_no_alert(self):
        """Margin > 20% should NOT generate P&L alert."""
        agent = self._create_agent()
        data = {
            "campaigns": [],
            "marketers": [],
            "pnl": [make_pnl(gross_margin=25, gross_profit=250)],
        }
        alerts = agent.analyze(data)
        margin_alerts = [a for a in alerts if a.get("type") == "margin"]
        self.assertEqual(len(margin_alerts), 0)

    def test_zero_margin_triggers_persuasion(self):
        """Margin = 0% should trigger persuasion alert + budget FREEZE."""
        agent = self._create_agent()
        data = {
            "campaigns": [],
            "marketers": [],
            "pnl": [make_pnl(gross_margin=0, gross_profit=0)],
        }
        alerts = agent.analyze(data)
        persuasion = [a for a in alerts if a.get("type") == "persuasion"]
        self.assertTrue(len(persuasion) >= 1)

    # ─── Empty Data Tests ─────────────────────────────────

    def test_empty_data_no_crash(self):
        """Empty data should produce zero alerts without crashing."""
        agent = self._create_agent()
        data = {
            "campaigns": [],
            "marketers": [],
            "pnl": [],
        }
        alerts = agent.analyze(data)
        self.assertIsInstance(alerts, list)

    def test_multiple_campaigns_mixed(self):
        """Mix of good and bad campaigns should produce correct alert count."""
        agent = self._create_agent()
        data = {
            "campaigns": [
                make_campaign(name="BAD1", roas=0.3, spend=200),
                make_campaign(name="OK1", roas=1.5, spend=100, campaign_id="c2"),
                make_campaign(name="GOOD1", roas=3.0, spend=150, campaign_id="c3"),
            ],
            "marketers": [],
            "pnl": [make_pnl(gross_margin=25)],
        }
        alerts = agent.analyze(data)
        roas_alerts = [a for a in alerts if a.get("type") == "roas"]
        # BAD1 = CRITICAL, OK1 = WARNING, GOOD1 = no alert
        self.assertEqual(len(roas_alerts), 2)

    # ─── Cleanup ──────────────────────────────────────────

    def tearDown(self):
        """Clean up test data directory."""
        test_dir = os.path.join(os.path.dirname(__file__), '.test_data')
        if os.path.exists(test_dir):
            import shutil
            shutil.rmtree(test_dir, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
