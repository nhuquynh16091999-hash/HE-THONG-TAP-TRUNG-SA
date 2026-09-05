"""
Tests for CAPI Push Workflow — SHA256 hashing and Meta API integration.

Run: pytest tests/test_capi.py -v
"""

from __future__ import annotations

import hashlib
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from faos_brain.workflows.capi_push import CAPIPushWorkflow


class TestHashField:
    """Test SHA256 hashing per Meta CAPI spec (Doc 02 §5.3)."""

    def test_hash_email(self):
        """Email: lowercase + trim + SHA256."""
        result = CAPIPushWorkflow.hash_field("  Test@Example.COM  ")
        expected = hashlib.sha256("test@example.com".encode("utf-8")).hexdigest()
        assert result == expected

    def test_hash_empty_returns_none(self):
        """Empty/whitespace-only values return None."""
        assert CAPIPushWorkflow.hash_field("") is None
        assert CAPIPushWorkflow.hash_field("   ") is None
        assert CAPIPushWorkflow.hash_field(None) is None

    def test_hash_name(self):
        """Names: lowercase + trim + SHA256."""
        result = CAPIPushWorkflow.hash_field("  Maria  ")
        expected = hashlib.sha256("maria".encode("utf-8")).hexdigest()
        assert result == expected

    def test_hash_is_64_chars(self):
        """SHA256 hex digest is always 64 characters."""
        result = CAPIPushWorkflow.hash_field("test")
        assert len(result) == 64
        assert result.isalnum()


class TestNormalizePhone:
    """Test phone normalization for Romanian numbers."""

    def test_romanian_with_plus(self):
        """+40 723 456 789 → hash of '40723456789'."""
        result = CAPIPushWorkflow.normalize_phone("+40 723 456 789")
        expected = hashlib.sha256("40723456789".encode("utf-8")).hexdigest()
        assert result == expected

    def test_romanian_with_leading_zero(self):
        """0723456789 → hash of '40723456789' (leading 0 → 40)."""
        result = CAPIPushWorkflow.normalize_phone("0723456789")
        expected = hashlib.sha256("40723456789".encode("utf-8")).hexdigest()
        assert result == expected

    def test_romanian_with_dashes(self):
        """0723-456-789 → hash of '40723456789'."""
        result = CAPIPushWorkflow.normalize_phone("0723-456-789")
        expected = hashlib.sha256("40723456789".encode("utf-8")).hexdigest()
        assert result == expected

    def test_international_format(self):
        """40723456789 (no leading 0) → hash of '40723456789'."""
        result = CAPIPushWorkflow.normalize_phone("40723456789")
        expected = hashlib.sha256("40723456789".encode("utf-8")).hexdigest()
        assert result == expected

    def test_empty_phone(self):
        """Empty phone returns None."""
        assert CAPIPushWorkflow.normalize_phone("") is None
        assert CAPIPushWorkflow.normalize_phone(None) is None
        assert CAPIPushWorkflow.normalize_phone("   ") is None


class TestRemoveDiacritics:
    """Test Romanian diacritics removal."""

    def test_romanian_city(self):
        """București → Bucuresti."""
        result = CAPIPushWorkflow.remove_diacritics("București")
        assert result == "Bucuresti"

    def test_with_cedilla(self):
        """Timișoara → Timisoara."""
        result = CAPIPushWorkflow.remove_diacritics("Timișoara")
        assert result == "Timisoara"

    def test_no_diacritics(self):
        """Plain text passes through unchanged."""
        result = CAPIPushWorkflow.remove_diacritics("Bucharest")
        assert result == "Bucharest"


class TestHashUserData:
    """Test the full user_data hashing pipeline."""

    def setup_method(self):
        self.workflow = CAPIPushWorkflow("stramark")

    def test_complete_order(self):
        """Full order produces all hashed fields."""
        order = {
            "order_id": "ORD_001",
            "customer_email": "test@example.com",
            "customer_phone": "0723456789",
            "customer_name": "Maria Popescu",
            "customer_city": "București",
            "customer_country_code": "RO",
        }

        result = self.workflow.hash_user_data(order)

        assert "em" in result
        assert "ph" in result
        assert "fn" in result
        assert "ln" in result
        assert "ct" in result
        assert "country" in result
        assert "external_id" in result

        # Verify all values are lists with SHA256 hashes
        for key in ["em", "ph", "fn", "ln", "ct", "country", "external_id"]:
            assert isinstance(result[key], list)
            assert len(result[key]) == 1
            assert len(result[key][0]) == 64

    def test_missing_fields(self):
        """Order with missing PII still works (omits None fields)."""
        order = {
            "order_id": "ORD_002",
            "customer_email": "",
            "customer_phone": "",
            "customer_name": "",
            "customer_city": "",
            "customer_country_code": "",
        }

        result = self.workflow.hash_user_data(order)

        # Only external_id should be present (order_id is not empty)
        assert "external_id" in result
        assert "em" not in result
        assert "ph" not in result


class TestBuildEvent:
    """Test CAPI event payload construction."""

    def setup_method(self):
        self.workflow = CAPIPushWorkflow("stramark")

    def test_event_structure(self):
        """Event has correct top-level structure."""
        order = {
            "order_id": "ORD_STRA_001",
            "event_time": 1709313600,
            "customer_email": "test@example.com",
            "customer_phone": "0723456789",
            "customer_name": "Maria Popescu",
            "customer_city": "Bucharest",
            "customer_country_code": "ro",
            "value": 189.0,
            "currency": "RON",
            "content_ids": ["D04"],
            "num_items": 1,
        }

        event = self.workflow.build_event(order)

        assert event["event_name"] == "Purchase"
        assert event["event_id"] == "ORD_STRA_001"
        assert event["event_time"] == 1709313600
        assert event["action_source"] == "website"
        assert "user_data" in event
        assert event["custom_data"]["value"] == 189.0
        assert event["custom_data"]["currency"] == "RON"
        assert event["custom_data"]["order_id"] == "ORD_STRA_001"


class TestPushToCAPI:
    """Test Meta API push with mocked httpx."""

    def setup_method(self):
        self.workflow = CAPIPushWorkflow("stramark")

    @pytest.mark.asyncio
    async def test_dry_run_no_http(self):
        """Dry run should NOT make any HTTP requests."""
        events = [{"event_name": "Purchase", "event_id": "ORD_001"}]

        with patch("httpx.AsyncClient") as mock_client:
            result = await self.workflow.push_to_capi(events, dry_run=True)

            # No HTTP calls in dry run
            mock_client.assert_not_called()
            assert result["events_received"] == 1

    @pytest.mark.asyncio
    @patch("faos_brain.workflows.capi_push.settings")
    async def test_live_push_success(self, mock_settings):
        """Live push with mocked HTTP 200 response."""
        mock_settings.meta_pixel_id = "12345"
        mock_settings.meta_access_token = "test_token_abc"

        events = [{"event_name": "Purchase", "event_id": "ORD_001"}]

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"events_received": 1, "fbtrace_id": "trace_abc"}

        with patch("httpx.AsyncClient") as mock_client_class:
            mock_client = AsyncMock()
            mock_client.post.return_value = mock_response
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)
            mock_client_class.return_value = mock_client

            result = await self.workflow.push_to_capi(events, dry_run=False)

            assert result["events_received"] == 1
            assert "trace_abc" in result["fbtrace_ids"]
