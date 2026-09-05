"""
Tests for FAOS API Endpoints — HTTP status and response validation.

Run: pytest tests/test_api_endpoints.py -v

Uses FastAPI TestClient for synchronous endpoint testing.
Mocks BQ and Graph dependencies to avoid external calls.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient


# ─── Mock dependencies BEFORE importing app ───
# This prevents real BQ/FalkorDB connections during tests

_mock_bq = MagicMock()
_mock_graph = MagicMock()


def _mock_get_bq_client():
    return _mock_bq


def _mock_get_graph_conn():
    return _mock_graph


# Patch DI providers
with patch("faos_brain.api.main.get_bq_client", _mock_get_bq_client), \
     patch("faos_brain.api.main.get_graph_conn", _mock_get_graph_conn):
    from faos_brain.api.main import app

# Override dependencies for TestClient
app.dependency_overrides = {
    __import__("faos_brain.api.main", fromlist=["get_bq_client"]).get_bq_client: _mock_get_bq_client,
    __import__("faos_brain.api.main", fromlist=["get_graph_conn"]).get_graph_conn: _mock_get_graph_conn,
}

client = TestClient(app)


class TestHealthEndpoint:
    """Test the health check endpoint."""

    def test_health_returns_200(self):
        resp = client.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert data["service"] == "faos-api"


class TestIntelligenceAPI:
    """Test AI Intelligence endpoints."""

    def test_accuracy_returns_200(self):
        """GET /api/ai-intelligence/accuracy should return 200."""
        # Mock BQ query result
        _mock_bq.query.return_value.result.return_value = []

        resp = client.get("/api/ai-intelligence/accuracy?project_id=stramark&days=30")
        assert resp.status_code == 200
        data = resp.json()
        assert "data" in data
        assert data["project_id"] == "stramark"

    def test_win_rate_returns_200(self):
        """GET /api/ai-intelligence/win-rate should return 200."""
        _mock_bq.query.return_value.result.return_value = []

        resp = client.get("/api/ai-intelligence/win-rate?project_id=stramark")
        assert resp.status_code == 200
        data = resp.json()
        assert "data" in data

    def test_lessons_returns_200(self):
        """GET /api/ai-intelligence/lessons should return 200."""
        _mock_graph.execute_query.return_value = []

        resp = client.get("/api/ai-intelligence/lessons?project_id=stramark")
        assert resp.status_code == 200


class TestPersonalityAPI:
    """Test Personality endpoints."""

    def test_get_personality_returns_200(self):
        """GET /api/personality/ should return 200."""
        _mock_graph.execute_query.return_value = []

        resp = client.get("/api/personality/?project_id=stramark")
        assert resp.status_code == 200
        data = resp.json()
        assert data["project_id"] == "stramark"

    def test_update_personality_valid_fields(self):
        """PUT /api/personality/ with valid fields returns 200."""
        _mock_graph.create_node.return_value = "personality_stramark"

        resp = client.put(
            "/api/personality/?project_id=stramark",
            json={"risk_level": "conservative", "daily_auto_ceiling": 5},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "updated"

    def test_update_personality_invalid_fields(self):
        """PUT /api/personality/ with only invalid fields returns 400."""
        resp = client.put(
            "/api/personality/?project_id=stramark",
            json={"invalid_field": "value"},
        )
        assert resp.status_code == 400


class TestMemoryAPI:
    """Test Memory Graph endpoints."""

    def test_sops_returns_200(self):
        """GET /api/memory/sops should return 200."""
        _mock_graph.execute_query.return_value = []

        resp = client.get("/api/memory/sops?project_id=stramark")
        assert resp.status_code == 200

    def test_decisions_returns_200(self):
        """GET /api/memory/decisions should return 200."""
        _mock_graph.execute_query.return_value = []

        resp = client.get("/api/memory/decisions?project_id=stramark")
        assert resp.status_code == 200

    def test_campaigns_returns_200(self):
        """GET /api/memory/campaigns should return 200."""
        _mock_graph.execute_query.return_value = []

        resp = client.get("/api/memory/campaigns?project_id=stramark")
        assert resp.status_code == 200

    def test_graph_stats_returns_200(self):
        """GET /api/memory/graph-stats should return 200."""
        _mock_graph.count_nodes.return_value = 5
        _mock_graph.health_check.return_value = True

        resp = client.get("/api/memory/graph-stats")
        assert resp.status_code == 200
        data = resp.json()
        assert "labels" in data
        assert data["healthy"] is True


class TestAuditAPI:
    """Test Audit endpoints."""

    def test_approval_logs_returns_200(self):
        """GET /api/audit/approvals should return 200."""
        _mock_bq.query.return_value.result.return_value = []

        resp = client.get("/api/audit/approvals?project_id=stramark")
        assert resp.status_code == 200
        data = resp.json()
        assert "data" in data


class TestAgentFeedAPI:
    """Test Agent Live Feed SSE endpoint."""

    def test_feed_endpoint_exists(self):
        """Verify /api/agent/{name}/feed route is registered."""
        # SSE streams are infinite — we cannot use TestClient.get() directly.
        # Instead, verify the route exists by checking the app's routes.
        routes = [r.path for r in app.routes if hasattr(r, "path")]
        assert "/api/agent-feed/{agent_name}/feed" in routes
