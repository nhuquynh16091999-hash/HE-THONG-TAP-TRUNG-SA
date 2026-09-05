"""Tests for FAOS Tools — tests basic imports, validation, and safety guards."""
import pytest
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


class TestBigQueryTool:
    """Tests for BigQuery tool safety and validation."""

    def test_blocks_write_queries(self):
        """Should block DELETE, DROP, UPDATE, INSERT."""
        from faos_agents.tools.bigquery_tool import query_bigquery
        for dangerous in ["DELETE FROM table", "DROP TABLE x", "UPDATE t SET", "INSERT INTO"]:
            result = query_bigquery(dangerous)
            assert "BLOCKED" in result

    def test_allows_select(self):
        """SELECT should not be blocked (may fail with auth but not blocked)."""
        from faos_agents.tools.bigquery_tool import query_bigquery
        # This will likely fail with auth error, but should NOT be blocked
        result = query_bigquery("SELECT 1 as test", project="test-project")
        assert "BLOCKED" not in result


class TestMetaAdsTool:
    """Tests for Meta Ads tool safety guards."""

    def test_budget_change_requires_reason(self):
        """update_adset_budget must have non-empty reason."""
        from faos_agents.tools.meta_ads_tool import update_adset_budget
        result = update_adset_budget("STRAMARK", "123", 1000, reason="")
        assert "BLOCKED" in result
        assert "MANDATORY" in result

    def test_pause_requires_reason(self):
        """pause_adset must have non-empty reason."""
        from faos_agents.tools.meta_ads_tool import pause_adset
        result = pause_adset("STRAMARK", "123", reason="")
        assert "BLOCKED" in result

    def test_dry_run_flag_exists(self):
        """DRY_RUN should be True by default."""
        from faos_agents.tools.meta_ads_tool import DRY_RUN
        assert DRY_RUN is True

    def test_max_budget_change_is_50_pct(self):
        """Max budget change should be 50%."""
        from faos_agents.tools.meta_ads_tool import MAX_BUDGET_CHANGE_PCT
        assert MAX_BUDGET_CHANGE_PCT == 0.50


class TestTelegramTool:
    """Tests for Telegram tool import and structure."""

    def test_import(self):
        """Should import without errors."""
        from faos_agents.tools.telegram_tool import send_telegram
        assert callable(send_telegram)


class TestDiscordTool:
    """Tests for Discord tool import and structure."""

    def test_import(self):
        """Should import without errors."""
        from faos_agents.tools.discord_tool import send_discord
        assert callable(send_discord)


class TestKnowledgeGraphTool:
    """Tests for Knowledge Graph tool structure."""

    def test_import(self):
        """Should import all functions."""
        from faos_agents.tools.knowledge_graph_tool import (
            save_episode, recall_episodes, save_knowledge, recall_knowledge,
        )
        assert callable(save_episode)
        assert callable(recall_episodes)
        assert callable(save_knowledge)
        assert callable(recall_knowledge)

    def test_graphiti_url_constant(self):
        """GRAPHITI_URL should default to localhost:8200."""
        from faos_agents.tools.knowledge_graph_tool import GRAPHITI_URL
        assert "8200" in GRAPHITI_URL


class TestPlaywrightTool:
    """Tests for Playwright tool structure."""

    def test_import(self):
        """Should import without errors."""
        from faos_agents.tools.playwright_tool import scrape_fb_ads_library, scrape_url
        assert callable(scrape_fb_ads_library)
        assert callable(scrape_url)
