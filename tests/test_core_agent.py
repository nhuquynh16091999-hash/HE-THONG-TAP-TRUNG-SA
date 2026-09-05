"""
Tests for Agent Core (CTO)
"""
import unittest
from unittest.mock import MagicMock, patch, mock_open
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# ─── MOCK DEPENDENCIES TO AVOID IMPORT ERRORS ───
from unittest.mock import MagicMock
sys.modules["google"] = MagicMock()
sys.modules["google.cloud"] = MagicMock()
sys.modules["google.cloud.bigquery"] = MagicMock()
sys.modules["tools.bq_client"] = MagicMock()
sys.modules["cryptography"] = MagicMock()
# ────────────────────────────────────────────────

from agents.core import AgentCore

class TestAgentCore(unittest.TestCase):
    
    def _create_agent(self):
        # Mock config loader
        with patch('tools.config_loader.load_project_config') as mock_load:
            mock_config = MagicMock()
            mock_config.bq_dataset = "test_ds"
            mock_config.bq_gcp_project = "test_proj"
            mock_config.discord_webhook = None
            mock_load.return_value = mock_config

            # Mock BigQuery and other external deps
            with patch('tools.bq_client.BigQueryClient') as MockBQ:
                agent = AgentCore(project_id="test_system", dry_run=True)
                agent.bq = MagicMock() 
                return agent

    @patch('agents.core.shutil')
    @patch('agents.core.psutil')
    def test_system_health_healthy(self, mock_psutil, mock_shutil):
        """Test healthy system stats."""
        # Disk: 100GB total, 50GB used (50%)
        mock_shutil.disk_usage.return_value = (100 * 1024**3, 50 * 1024**3, 50 * 1024**3)
        # CPU/Mem
        mock_psutil.cpu_percent.return_value = 10.0
        mock_psutil.virtual_memory.return_value.percent = 40.0

        agent = self._create_agent()
        # Mock logs to be empty
        with patch.object(agent, '_scan_recent_logs', return_value=[]):
            data = agent.fetch_data()
            alerts = agent.analyze(data)
        
        self.assertEqual(len(alerts), 0)

    @patch('agents.core.shutil')
    def test_disk_critical(self, mock_shutil):
        """Test disk full alert."""
        # 95% used
        mock_shutil.disk_usage.return_value = (100, 95, 5) 
        
        agent = self._create_agent()
        # Mock psutil missing and logs empty
        with patch('agents.core.psutil', None), \
             patch.object(agent, '_scan_recent_logs', return_value=[]):
            data = agent.fetch_data()
            alerts = agent.analyze(data)
        
        self.assertTrue(any("Disk Usage" in a["metrics"] for a in alerts))
        self.assertTrue(any("CRITICAL" in a["level"] for a in alerts))

    def test_log_error_detection(self):
        """Test parsing of log errors."""
        agent = self._create_agent()
        
        # Mock log reading
        mock_log_content = """
        2024-01-01 10:00:00 | INFO | starting
        2024-01-01 10:01:00 | ERROR | Connection refused
        2024-01-01 10:02:00 | CRITICAL | Database down
        """
        
        with patch('os.listdir', return_value=['proj1']), \
             patch('os.path.isdir', return_value=True), \
             patch('os.path.exists', return_value=True), \
             patch('builtins.open', mock_open(read_data=mock_log_content)):
            
            data = agent.fetch_data()
            alerts = agent.analyze(data)
            
            # Should find 2 errors
            log_alerts = [a for a in alerts if a["type"] == "logs"]
            self.assertEqual(len(log_alerts), 1)
            self.assertIn("Found 2 Errors", log_alerts[0]["metrics"])

if __name__ == '__main__':
    unittest.main()
