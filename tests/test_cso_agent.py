import unittest
from unittest.mock import MagicMock, patch
from agents.strategy_officer import StrategyOfficer

class TestStrategyOfficer(unittest.TestCase):
    
    def _create_agent(self):
        # Mock config loader
        with patch('tools.config_loader.load_project_config') as mock_load:
            mock_config = MagicMock()
            mock_config.bq_dataset = "test_ds"
            mock_config.bq_gcp_project = "test_proj"
            mock_config.discord_webhook = None
            mock_load.return_value = mock_config

            with patch('tools.bq_client.BigQueryClient') as MockBQ:
                agent = StrategyOfficer(project_id="test_system", dry_run=True)
                agent.bq = MagicMock()
                return agent

    def test_market_trend_alert(self):
        """Test if CSO detects exploding trends."""
        agent = self._create_agent()
        data = {
            "market_trends": [
                {"keyword": "ai agents", "trend": "up", "volume_growth": 200},
            ]
        }
        alerts = agent.analyze(data)
        self.assertTrue(any("strategic_directive" in a["type"] for a in alerts))
        self.assertTrue(any("exploding" in a["metrics"] for a in alerts))

    def test_macro_warning(self):
        """Test macro economic warnings."""
        agent = self._create_agent()
        data = {
            "macro_factors": {
                "ad_costs_trend": "rising"
            }
        }
        alerts = agent.analyze(data)
        self.assertTrue(any("market_warning" in a["type"] for a in alerts))
        self.assertIn("tighten budget", alerts[0]["suggestion"])

if __name__ == '__main__':
    unittest.main()
