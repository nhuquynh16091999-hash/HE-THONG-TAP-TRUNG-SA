"""
🎯 Unit Tests for MarketingAdvisor (G3 CMO Agent)

Tests analyze() and _analyze_campaign() logic with mock API data.
Does NOT touch Meta API, BigQuery, or any external service.
"""
import unittest
import sys, os

# Setup path
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

# ─── MOCK DEPENDENCIES TO AVOID IMPORT ERRORS ───
from unittest.mock import MagicMock
sys.modules["google"] = MagicMock()
sys.modules["google.cloud"] = MagicMock()
sys.modules["google.cloud.bigquery"] = MagicMock()
sys.modules["tools.bq_client"] = MagicMock()
sys.modules["cryptography"] = MagicMock()
# ────────────────────────────────────────────────


def make_campaign(name="Test Campaign", spend=10, roas=2.0,
                  impressions=5000, clicks=100, orders=5,
                  budget=5000, spend_3d=30, roas_3d=2.0, campaign_id="c1"):
    """Create a mock campaign dict (simulates Meta API response)."""
    return {
        "id": campaign_id,
        "name": name,
        "daily_budget": str(budget),
        "insights": {
            "data": [{
                "spend": str(spend),
                "impressions": str(impressions),
                "clicks": str(clicks),
                "actions": [{"action_type": "purchase", "value": str(orders)}],
                "action_values": [{"action_type": "purchase", "value": str(spend * roas)}],
            }]
        } if spend > 0 else {},
        "insights_3d": {
            "data": [{
                "spend": str(spend_3d),
                "action_values": [{"action_type": "purchase", "value": str(spend_3d * roas_3d)}],
            }]
        } if spend_3d > 0 else {},
    }


class TestMarketingAdvisorAnalyze(unittest.TestCase):
    """Test MarketingAdvisor.analyze() logic without Meta API."""

    def _create_agent(self):
        """Create agent instance with mock dependencies."""
        from agents.marketing_advisor import MarketingAdvisor
        agent = object.__new__(MarketingAdvisor)
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

    # ─── LESSON 8: Stale Data Guard ─────────────────────

    def test_stale_data_stops_all_analysis(self):
        """When API is unhealthy, only STALE DATA alert should be returned."""
        agent = self._create_agent()
        data = {
            "api_healthy": False,
            "campaigns": {"acc1": [make_campaign()]},
        }
        alerts = agent.analyze(data)
        self.assertEqual(len(alerts), 1)
        self.assertEqual(alerts[0]["type"], "!! STALE DATA")

    def test_healthy_api_proceeds(self):
        """When API is healthy, campaigns should be analyzed."""
        agent = self._create_agent()
        data = {
            "api_healthy": True,
            "campaigns": {"acc1": [make_campaign(roas=0.5, roas_3d=0.5)]},
        }
        alerts = agent.analyze(data)
        stale = [a for a in alerts if a["type"] == "!! STALE DATA"]
        self.assertEqual(len(stale), 0)

    # ─── LESSON 1: 3-Day Kill Rule ──────────────────────

    def test_kill_confirmed_low_roas_both_today_and_3d(self):
        """ROAS < 1.2 today AND < 1.6 for 3d → KILL confirmed."""
        agent = self._create_agent()
        data = {
            "campaigns": {"acc1": [make_campaign(
                spend=20, roas=0.5, roas_3d=1.0, spend_3d=60
            )]},
        }
        alerts = agent.analyze(data)
        kills = [a for a in alerts if "KILL" in a["type"]]
        self.assertTrue(len(kills) >= 1)

    def test_monitor_volatile_today_bad_3d_ok(self):
        """ROAS < 1.2 today but >= 1.6 for 3d → MONITOR (volatile)."""
        agent = self._create_agent()
        data = {
            "campaigns": {"acc1": [make_campaign(
                spend=20, roas=0.5, roas_3d=2.0, spend_3d=60
            )]},
        }
        alerts = agent.analyze(data)
        monitors = [a for a in alerts if "MONITOR" in a["type"]]
        self.assertTrue(len(monitors) >= 1)

    def test_good_roas_no_kill_alert(self):
        """ROAS >= 1.2 should NOT trigger KILL or MONITOR."""
        agent = self._create_agent()
        data = {
            "campaigns": {"acc1": [make_campaign(
                spend=20, roas=2.0, roas_3d=2.5, spend_3d=60
            )]},
        }
        alerts = agent.analyze(data)
        kills = [a for a in alerts if "KILL" in a["type"] or "MONITOR" in a["type"]]
        self.assertEqual(len(kills), 0)

    # ─── LESSON 2: Creative Intelligence ────────────────

    def test_creative_fatigue_low_ctr(self):
        """CTR < 0.8% with enough impressions → CREATIVE FATIGUE."""
        agent = self._create_agent()
        data = {
            "campaigns": {"acc1": [make_campaign(
                spend=10, impressions=5000, clicks=20, orders=1,
                roas=2.0, roas_3d=2.0
            )]},
        }
        alerts = agent.analyze(data)
        fatigue = [a for a in alerts if "CREATIVE FATIGUE" in a["type"]]
        self.assertTrue(len(fatigue) >= 1)

    def test_check_web_high_clicks_zero_orders(self):
        """Many clicks but zero orders → CHECK WEB/PRICE."""
        agent = self._create_agent()
        data = {
            "campaigns": {"acc1": [make_campaign(
                spend=10, impressions=10000, clicks=100, orders=0,
                roas=0, roas_3d=2.0
            )]},
        }
        alerts = agent.analyze(data)
        web_check = [a for a in alerts if "CHECK WEB" in a["type"]]
        self.assertTrue(len(web_check) >= 1)

    # ─── SCALE Signal ───────────────────────────────────

    def test_scale_signal_high_roas_3d(self):
        """3-Day ROAS > 3.0 and spend > 20 → SCALE recommendation."""
        agent = self._create_agent()
        data = {
            "campaigns": {"acc1": [make_campaign(
                spend=10, roas=4.0, roas_3d=4.0, spend_3d=50
            )]},
        }
        alerts = agent.analyze(data)
        scale = [a for a in alerts if "SCALE" in a["type"]]
        self.assertTrue(len(scale) >= 1)

    # ─── LESSON 3: Budget Pacing ────────────────────────
    
    def test_flash_burn_high_spend_pct(self):
        """Spending > 80% of budget → FLASH BURN warning."""
        agent = self._create_agent()
        # budget=5000 ($50), spend=250 ($250) → 500% spend (Definite Flash Burn)
        data = {
            "campaigns": {"acc1": [make_campaign(
                spend=250, budget=5000, roas=2.0, roas_3d=2.0
            )]},
        }
        alerts = agent.analyze(data)
        flash = [a for a in alerts if "FLASH BURN" in a["type"] or "BUDGET EXHAUSTED" in a["type"]]
        self.assertTrue(len(flash) >= 1)

    # ─── Empty / Edge Cases ─────────────────────────────

    def test_empty_campaigns_no_crash(self):
        """Empty campaign list should produce zero alerts."""
        agent = self._create_agent()
        data = {"campaigns": {"acc1": []}}
        alerts = agent.analyze(data)
        self.assertIsInstance(alerts, list)

    def test_no_insights_data_no_crash(self):
        """Campaign with empty insights should not crash."""
        agent = self._create_agent()
        data = {
            "campaigns": {"acc1": [{
                "id": "c1", "name": "NoData",
                "daily_budget": "0",
                "insights": {}, "insights_3d": {},
            }]},
        }
        alerts = agent.analyze(data)
        self.assertIsInstance(alerts, list)


if __name__ == "__main__":
    unittest.main()
