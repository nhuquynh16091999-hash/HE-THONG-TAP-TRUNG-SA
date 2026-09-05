"""
Integration tests for the BOTCAKE inventory webhook endpoint.

Run: pytest tests/test_inventory_api_botcake.py -v

Uses FastAPI TestClient with mocked PoscakeInventoryService
to avoid real HTTP calls to Poscake API.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

# ── Mock BQ/Graph deps before importing app (same pattern as test_api_endpoints.py) ──
_mock_bq = MagicMock()
_mock_graph = MagicMock()

with (
    patch("faos_brain.api.main.get_bq_client", lambda: _mock_bq),
    patch("faos_brain.api.main.get_graph_conn", lambda: _mock_graph),
):
    from faos_brain.api.main import app

client = TestClient(app)

# ── Mock data ────────────────────────────────────────────────────────────────

IN_STOCK_RESULT = {
    "sku": "TUONG_001",
    "name": "Tượng Phật Di Lặc",
    "in_stock": True,
    "qty": 15,
}
OUT_STOCK_RESULT = {
    "sku": "TUONG_002",
    "name": "Tượng Phật Quan Âm",
    "in_stock": False,
    "qty": 0,
}
ALTERNATIVES = [
    {"sku": "LUCKY_001", "name": "Lucky Charm Set", "qty": 3},
]

# ── Tests ─────────────────────────────────────────────────────────────────────


class TestInventoryCheckRoute:
    """Verify /api/inventory/check route is registered."""

    def test_route_exists(self):
        routes = [r.path for r in app.routes if hasattr(r, "path")]
        assert "/api/inventory/check" in routes


class TestInventoryCheckEndpoint:
    """Test inventory check endpoint responses."""

    def test_in_stock_returns_200_with_empty_alternatives(self):
        with (
            patch("faos_brain.api.inventory_api.settings") as mock_settings,
            patch("faos_brain.api.inventory_api.PoscakeInventoryService") as MockSvc,
        ):
            mock_settings.botcake_poscake_api_key = "test-key"
            mock_settings.botcake_poscake_shop_id = "test-shop"
            instance = MockSvc.return_value
            instance.check_stock = AsyncMock(return_value=IN_STOCK_RESULT)
            instance.get_alternatives = AsyncMock(return_value=[])

            resp = client.get("/api/inventory/check", params={"sku": "TUONG_001"})

        assert resp.status_code == 200
        data = resp.json()
        assert data["in_stock"] is True
        assert data["qty"] == 15
        assert data["alternatives"] == []

    def test_out_of_stock_returns_alternatives(self):
        with (
            patch("faos_brain.api.inventory_api.settings") as mock_settings,
            patch("faos_brain.api.inventory_api.PoscakeInventoryService") as MockSvc,
        ):
            mock_settings.botcake_poscake_api_key = "test-key"
            mock_settings.botcake_poscake_shop_id = "test-shop"
            instance = MockSvc.return_value
            instance.check_stock = AsyncMock(return_value=OUT_STOCK_RESULT)
            instance.get_alternatives = AsyncMock(return_value=ALTERNATIVES)

            resp = client.get("/api/inventory/check", params={"sku": "TUONG_002"})

        assert resp.status_code == 200
        data = resp.json()
        assert data["in_stock"] is False
        assert len(data["alternatives"]) == 1
        assert data["alternatives"][0]["sku"] == "LUCKY_001"

    def test_missing_sku_returns_422(self):
        resp = client.get("/api/inventory/check")
        assert resp.status_code == 422

    def test_missing_env_vars_returns_503(self):
        with patch("faos_brain.api.inventory_api.settings") as mock_settings:
            mock_settings.botcake_poscake_api_key = ""
            mock_settings.botcake_poscake_shop_id = ""

            resp = client.get("/api/inventory/check", params={"sku": "TUONG_001"})

        assert resp.status_code == 503
        assert "not configured" in resp.json()["detail"]
