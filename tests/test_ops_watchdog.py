"""
📦 Unit Tests for OpsWatchdog (A9 COO Agent)

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


def make_inventory(name="Widget A", qty=0, sku="WA-001", custom_id="WA"):
    """Create a mock inventory row."""
    return SimpleNamespace(
        product_name=name,
        custom_id=custom_id,
        stock_qty=qty,
        sku=sku,
    )


def make_stuck_order(order_id="ORD-001", hours=48, status="waitting", status_name="Chờ xử lý"):
    """Create a mock stuck order row."""
    return SimpleNamespace(
        order_id=order_id,
        hours_stuck=hours,
        status=status,
        status_name=status_name,
    )


def make_return_row(date="2026-02-15", total=100, returned=30, rate=0.30):
    """Create a mock return rate row."""
    return SimpleNamespace(
        order_date=date,
        total=total,
        returned=returned,
        return_rate=rate,
    )


def make_fulfillment(status="waitting", status_name="Chờ xử lý", count=5, avg_hours=30):
    """Create a mock fulfillment SLA row."""
    return SimpleNamespace(
        status=status,
        status_name=status_name,
        count=count,
        avg_hours=avg_hours,
    )


class TestOpsWatchdogAnalyze(unittest.TestCase):
    """Test OpsWatchdog.analyze() logic without BigQuery."""

    class MockMemory:
        def __init__(self):
            self.decisions = []
            self.alerts = []

        def log_decision(self, entity_id, decision, reason, context=None):
            self.decisions.append({
                "entity_id": entity_id,
                "decision": decision,
                "reason": reason,
                "context": context
            })
            
        def publish_alert(self, alert_type, payload):
            self.alerts.append({"type": alert_type, "payload": payload})

    def _create_agent(self):
        """Create agent instance with mock dependencies."""
        from agents.ops_watchdog import OpsWatchdog
        # Trick: create instance but skip __init__
        agent = object.__new__(OpsWatchdog)
        agent.project_id = "test"
        agent.days = 7
        agent.dry_run = True
        agent.memory = self.MockMemory()
        agent.log = type('MockLog', (), {
            'info': lambda self, msg: None,
            'warning': lambda self, msg: None,
            'error': lambda self, msg: None,
        })()
        agent._data_dir = os.path.join(os.path.dirname(__file__), '.test_data')
        os.makedirs(agent._data_dir, exist_ok=True)
        return agent

    # ─── Inventory Tests ────────────────────────────────

    def test_oos_creates_critical_alert(self):
        """Product with stock_qty=0 → CRITICAL inventory alert."""
        agent = self._create_agent()
        data = {
            "inventory": [make_inventory(qty=0)],
            "stuck": [],
            "returns": [],
            "fulfillment": [],
        }
        alerts = agent.analyze(data)
        inv = [a for a in alerts if a["type"] == "inventory"]
        self.assertEqual(len(inv), 1)
        self.assertEqual(inv[0]["level"], "CRITICAL")

    def test_low_stock_creates_warning_alert(self):
        """Product with stock_qty > 0 → WARNING inventory alert."""
        agent = self._create_agent()
        data = {
            "inventory": [make_inventory(qty=3)],
            "stuck": [],
            "returns": [],
            "fulfillment": [],
        }
        alerts = agent.analyze(data)
        inv = [a for a in alerts if a["type"] == "inventory"]
        self.assertEqual(len(inv), 1)
        self.assertEqual(inv[0]["level"], "WARNING")

    # ─── Stuck Order Tests ──────────────────────────────

    def test_stuck_order_over_72h_is_critical(self):
        """Order stuck > 72 hours → CRITICAL."""
        agent = self._create_agent()
        data = {
            "inventory": [],
            "stuck": [make_stuck_order(hours=96)],
            "returns": [],
            "fulfillment": [],
        }
        alerts = agent.analyze(data)
        stuck = [a for a in alerts if a["type"] == "stuck"]
        self.assertEqual(len(stuck), 1)
        self.assertEqual(stuck[0]["level"], "CRITICAL")

    def test_stuck_order_under_72h_is_warning(self):
        """Order stuck < 72 hours → WARNING."""
        agent = self._create_agent()
        data = {
            "inventory": [],
            "stuck": [make_stuck_order(hours=48)],
            "returns": [],
            "fulfillment": [],
        }
        alerts = agent.analyze(data)
        stuck = [a for a in alerts if a["type"] == "stuck"]
        self.assertEqual(len(stuck), 1)
        self.assertEqual(stuck[0]["level"], "WARNING")

    def test_3_stuck_orders_trigger_persuasion(self):
        """3+ stuck orders → PERSUASION alert."""
        agent = self._create_agent()
        data = {
            "inventory": [],
            "stuck": [
                make_stuck_order(order_id="O1", hours=30),
                make_stuck_order(order_id="O2", hours=50),
                make_stuck_order(order_id="O3", hours=20),
                make_stuck_order(order_id="O4", hours=25),
                make_stuck_order(order_id="O5", hours=40),
            ],
            "returns": [],
            "fulfillment": [],
        }
        alerts = agent.analyze(data)
        persuasion = [a for a in alerts if a["type"] == "persuasion"]
        self.assertTrue(len(persuasion) >= 1)
        
        # Memory Check
        decisions = agent.memory.decisions
        self.assertTrue(len(decisions) >= 1)
        self.assertEqual(decisions[0]["decision"], "STUCK_ALERT")
        self.assertIn(" orders stuck", decisions[0]["reason"])

    # ─── Return Rate Tests ──────────────────────────────

    def test_high_return_rate_warning(self):
        """Return rate > 25% (RETURN_MAX) → WARNING."""
        agent = self._create_agent()
        data = {
            "inventory": [],
            "stuck": [],
            "returns": [make_return_row(rate=0.35)],
            "fulfillment": [],
        }
        alerts = agent.analyze(data)
        returns = [a for a in alerts if a["type"] == "return"]
        self.assertTrue(len(returns) >= 1)
        self.assertEqual(returns[0]["level"], "WARNING")

    def test_normal_return_rate_no_alert(self):
        """Return rate < 25% → no return alert."""
        agent = self._create_agent()
        data = {
            "inventory": [],
            "stuck": [],
            "returns": [make_return_row(rate=0.10)],
            "fulfillment": [],
        }
        alerts = agent.analyze(data)
        returns = [a for a in alerts if a["type"] == "return"]
        self.assertEqual(len(returns), 0)

    # ─── Empty / Edge Cases ─────────────────────────────

    def test_empty_data_no_crash(self):
        """All empty lists → zero alerts, no crash."""
        agent = self._create_agent()
        data = {
            "inventory": [],
            "stuck": [],
            "returns": [],
            "fulfillment": [],
        }
        alerts = agent.analyze(data)
        self.assertIsInstance(alerts, list)
        self.assertEqual(len(alerts), 0)

    # ─── Cleanup ────────────────────────────────────────

    def tearDown(self):
        test_dir = os.path.join(os.path.dirname(__file__), '.test_data')
        if os.path.exists(test_dir):
            import shutil
            shutil.rmtree(test_dir, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
