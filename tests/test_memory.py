"""Tests for FAOS AgentMemory — uses mocked knowledge graph."""
import pytest
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


class TestAgentMemory:
    """Tests for AgentMemory class with mocked Graphiti."""

    def test_init(self):
        """Should initialize without errors."""
        from faos_agents.memory.agent_memory import AgentMemory
        mem = AgentMemory("test_agent", graphiti_url="http://localhost:9999")
        assert mem.agent_name == "test_agent"
        assert mem.graphiti_url == "http://localhost:9999"

    def test_save_decision_returns_string(self):
        """save_decision should return a string (even if Graphiti is down)."""
        from faos_agents.memory.agent_memory import AgentMemory
        mem = AgentMemory("test_agent", graphiti_url="http://localhost:9999")
        result = mem.save_decision(
            action="Increased budget +20%",
            reasoning="ROAS 3.2 > target 2.0",
            context={"adset_id": "123", "budget": 1200},
        )
        assert isinstance(result, str)
        # Should not crash even if Graphiti is unreachable

    def test_recall_decisions_returns_list(self):
        """recall_decisions should return a list."""
        from faos_agents.memory.agent_memory import AgentMemory
        mem = AgentMemory("test_agent", graphiti_url="http://localhost:9999")
        result = mem.recall_decisions("budget")
        assert isinstance(result, list)

    def test_save_learning_returns_string(self):
        """save_learning should return a string."""
        from faos_agents.memory.agent_memory import AgentMemory
        mem = AgentMemory("test_agent", graphiti_url="http://localhost:9999")
        result = mem.save_learning(
            insight="CPA target for STRAMARK = 18 RON",
            evidence="Based on 30 decisions, 18 RON = 85% accuracy",
        )
        assert isinstance(result, str)

    def test_recall_learnings_returns_list(self):
        """recall_learnings should return a list."""
        from faos_agents.memory.agent_memory import AgentMemory
        mem = AgentMemory("test_agent", graphiti_url="http://localhost:9999")
        result = mem.recall_learnings("CPA")
        assert isinstance(result, list)

    def test_daily_reflection_no_actions(self):
        """Empty actions list should return no-action message."""
        from faos_agents.memory.agent_memory import AgentMemory
        mem = AgentMemory("test_agent", graphiti_url="http://localhost:9999")
        result = mem.daily_reflection(today_actions=[], today_results=[])
        assert "No actions" in result

    def test_daily_reflection_with_actions(self):
        """Should calculate success rate correctly."""
        from faos_agents.memory.agent_memory import AgentMemory
        mem = AgentMemory("test_agent", graphiti_url="http://localhost:9999")

        actions = [
            {"action": "scale_A", "expected_outcome": "more orders"},
            {"action": "pause_B", "expected_outcome": "stop waste"},
            {"action": "scale_C", "expected_outcome": "more orders"},
        ]
        results = [
            {"action": "scale_A", "success": True, "actual_outcome": "orders +20%"},
            {"action": "pause_B", "success": True, "actual_outcome": "saved $50"},
            {"action": "scale_C", "success": False, "actual_outcome": "CPA spiked"},
        ]
        result = mem.daily_reflection(actions, results)
        assert "2/3" in result  # 2 out of 3 correct
        assert "67%" in result or "66%" in result  # ~66.7% success rate

    def test_get_agent_stats(self):
        """Should return dict with agent_name."""
        from faos_agents.memory.agent_memory import AgentMemory
        mem = AgentMemory("test_agent", graphiti_url="http://localhost:9999")
        stats = mem.get_agent_stats()
        assert stats["agent_name"] == "test_agent"
        assert "total_decisions" in stats
