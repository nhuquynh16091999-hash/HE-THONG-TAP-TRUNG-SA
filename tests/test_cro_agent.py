import unittest
from unittest.mock import MagicMock, patch
from agents.revenue_optimizer import RevenueOptimizer

class TestRevenueOptimizer(unittest.TestCase):
    
    def _create_agent(self):
        # Mock config loader to avoid FileNotFoundError
        with patch('tools.config_loader.load_project_config') as mock_load:
            mock_config = MagicMock()
            mock_config.bq_dataset = "test_ds"
            mock_config.bq_gcp_project = "test_proj"
            mock_config.discord_webhook = None
            mock_load.return_value = mock_config

            with patch('tools.bq_client.BigQueryClient') as MockBQ:
                agent = RevenueOptimizer(project_id="test_system", dry_run=True)
                agent.bq = MagicMock()
                return agent

    def test_cro_churn_alert(self):
        """Test if CRO detects churn risk."""
        agent = self._create_agent()
        data = {
            "customers": [
                {"id": "c2", "total_spent": 50, "orders_count": 1, "last_order_days": 40} # Churn Risk
            ]
        }
        alerts = agent.analyze(data)
        self.assertTrue(any("churn risk" in a["metrics"] for a in alerts))

    def test_cro_vip_alert(self):
        """Test if CRO detects VIPs."""
        agent = self._create_agent()
        data = {
            "customers": [
                 {"id": "c1", "total_spent": 500, "orders_count": 5, "last_order_days": 2} # VIP
            ]
        }
        alerts = agent.analyze(data)
        self.assertTrue(any("vip" in a["type"] for a in alerts))

    def test_pricing_strategy(self):
        """Test dynamic pricing logic."""
        agent = self._create_agent()
        data = {
            "products": [
                 {"sku": "SLOW_SKU", "price": 100, "sales_velocity": 0.5, "stock": 50},
                 {"sku": "FAST_SKU", "price": 50, "sales_velocity": 10, "stock": 20}
            ]
        }
        alerts = agent.analyze(data)
        
        slow_alert = next((a for a in alerts if "SLOW_SKU" in a["metrics"]), None)
        fast_alert = next((a for a in alerts if "FAST_SKU" in a["metrics"]), None)

        self.assertIsNotNone(slow_alert)
        self.assertIn("Lower price", slow_alert["suggestion"])
        
        self.assertIsNotNone(fast_alert)
        self.assertIn("raising price", fast_alert["suggestion"])

if __name__ == '__main__':
    unittest.main()
