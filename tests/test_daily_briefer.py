"""
📊 Unit Tests for DailyBriefer Agent

Tests analyze() and format_message() logic with mock data.
Does NOT touch BigQuery or any external service.
"""
import unittest
import sys, os
from types import SimpleNamespace

# Setup path
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))


def make_overall(total=50, delivered=45, returned=5, crev=5000):
    """Create a mock overall row."""
    return SimpleNamespace(
        total_order=total,
        delivered_order=delivered,
        returned_order=returned,
        crev=crev,
        new=10,
        confirmed=10,
        packed=5,
        shipping=15,
        delivered=delivered,
        returned=returned,
    )


def make_spend(spend=300, roas=2.5, orders=20):
    """Create a mock spend data row."""
    return SimpleNamespace(
        spend=spend,
        roas=roas,
        orders=orders,
    )


class TestDailyBrieferAnalyze(unittest.TestCase):
    """Test DailyBriefer.analyze() logic without BigQuery."""

    def _create_agent(self):
        """Create agent instance with mock dependencies."""
        from agents.daily_briefer import DailyBriefer
        agent = object.__new__(DailyBriefer)
        agent.project_id = "test"
        agent.days = 1
        agent.dry_run = True
        agent.memory = None
        agent.log = type('MockLog', (), {
            'info': lambda self, msg: None,
            'warning': lambda self, msg: None,
            'error': lambda self, msg: None,
        })()
        return agent

    def test_analyze_returns_data(self):
        """analyze() should pass through the data dict."""
        agent = self._create_agent()
        data = {
            "overall": make_overall(),
            "spend_data": make_spend(),
        }
        result = agent.analyze(data)
        self.assertEqual(len(result), 1)
        self.assertIn("overall", result[0])
        self.assertIn("spend_data", result[0])

    def test_analyze_with_zero_spend(self):
        """Zero spend should not crash."""
        agent = self._create_agent()
        data = {
            "overall": make_overall(),
            "spend_data": make_spend(spend=0, roas=0),
        }
        result = agent.analyze(data)
        self.assertEqual(len(result), 1)

    def test_analyze_with_none_values(self):
        """None values in overall/spend should not crash."""
        agent = self._create_agent()
        data = {
            "overall": SimpleNamespace(
                total_order=None, delivered_order=None,
                returned_order=None, crev=None,
                new=None, confirmed=None, packed=None,
                shipping=None, delivered=None, returned=None,
            ),
            "spend_data": SimpleNamespace(spend=None, roas=None, orders=None),
        }
        result = agent.analyze(data)
        self.assertIsInstance(result, list)

    def test_analyze_empty_overall_and_spend(self):
        """None overall and None spend → still returns data."""
        agent = self._create_agent()
        data = {"overall": None, "spend_data": None}
        # analyze() accesses data["overall"] directly, so None should still work
        # It checks `if ov and sp:` so None skips the logging
        result = agent.analyze(data)
        self.assertEqual(len(result), 1)


if __name__ == "__main__":
    unittest.main()
