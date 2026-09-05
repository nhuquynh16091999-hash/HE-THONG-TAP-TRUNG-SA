"""
Tests for PoscakeInventoryService — unit tests with mocked HTTP.

Run: pytest tests/test_poscake_inventory.py -v
"""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from faos_brain.services.poscake_inventory import PoscakeInventoryService

# ── Fixtures ──────────────────────────────────────────────────────────────────

MOCK_PRODUCTS = [
    {
        "code": "TUONG_PHAT_001",
        "name": "Tượng Phật Di Lặc",
        "variations": [
            {
                "code": "TUONG_PHAT_001",
                "variations_warehouses": [
                    {"actual_remain_quantity": 10},
                    {"actual_remain_quantity": 5},
                ],
            }
        ],
    },
    {
        "code": "TUONG_PHAT_002",
        "name": "Tượng Phật Quan Âm",
        "variations": [
            {
                "code": "TUONG_PHAT_002",
                "variations_warehouses": [
                    {"actual_remain_quantity": 0},
                ],
            }
        ],
    },
    {
        "code": "LUCKY_CHARM_001",
        "name": "Lucky Charm Set",
        "variations": [
            {
                "code": "LUCKY_CHARM_001",
                "variations_warehouses": [
                    {"actual_remain_quantity": 3},
                ],
            }
        ],
    },
]


@pytest.fixture
def svc() -> PoscakeInventoryService:
    return PoscakeInventoryService(api_key="test-key", shop_id="test-shop")


# ── Tests ─────────────────────────────────────────────────────────────────────


class TestCheckStock:
    @pytest.mark.asyncio
    async def test_in_stock_returns_correct_qty(self, svc):
        with patch.object(svc, "_fetch_products", new=AsyncMock(return_value=MOCK_PRODUCTS)):
            result = await svc.check_stock("TUONG_PHAT_001")
        assert result["in_stock"] is True
        assert result["qty"] == 15  # 10 + 5 across 2 warehouses
        assert result["sku"] == "TUONG_PHAT_001"
        assert result["name"] == "Tượng Phật Di Lặc"

    @pytest.mark.asyncio
    async def test_out_of_stock_returns_false(self, svc):
        with patch.object(svc, "_fetch_products", new=AsyncMock(return_value=MOCK_PRODUCTS)):
            result = await svc.check_stock("TUONG_PHAT_002")
        assert result["in_stock"] is False
        assert result["qty"] == 0

    @pytest.mark.asyncio
    async def test_sku_not_found_returns_false(self, svc):
        with patch.object(svc, "_fetch_products", new=AsyncMock(return_value=MOCK_PRODUCTS)):
            result = await svc.check_stock("NONEXISTENT_SKU")
        assert result["in_stock"] is False
        assert result["qty"] == 0
        assert result["sku"] == "NONEXISTENT_SKU"

    @pytest.mark.asyncio
    async def test_api_error_returns_graceful_fallback(self, svc):
        import httpx
        with patch.object(
            svc,
            "_fetch_products",
            new=AsyncMock(side_effect=httpx.ConnectError("Connection refused")),
        ):
            result = await svc.check_stock("TUONG_PHAT_001")
        assert result["in_stock"] is False
        assert "error" in result


class TestGetAlternatives:
    @pytest.mark.asyncio
    async def test_returns_in_stock_alternatives_excluding_given_sku(self, svc):
        with patch.object(svc, "_fetch_products", new=AsyncMock(return_value=MOCK_PRODUCTS)):
            alts = await svc.get_alternatives(exclude_sku="TUONG_PHAT_001", limit=2)
        # TUONG_PHAT_002 is out of stock, LUCKY_CHARM_001 has qty=3
        assert len(alts) == 1
        assert alts[0]["sku"] == "LUCKY_CHARM_001"
        assert alts[0]["qty"] == 3

    @pytest.mark.asyncio
    async def test_respects_limit(self, svc):
        with patch.object(svc, "_fetch_products", new=AsyncMock(return_value=MOCK_PRODUCTS)):
            alts = await svc.get_alternatives(exclude_sku="NONEXISTENT", limit=1)
        assert len(alts) <= 1

    @pytest.mark.asyncio
    async def test_api_error_returns_empty_list(self, svc):
        import httpx
        with patch.object(
            svc,
            "_fetch_products",
            new=AsyncMock(side_effect=httpx.ConnectError("Connection refused")),
        ):
            alts = await svc.get_alternatives(exclude_sku="TUONG_PHAT_001")
        assert alts == []
