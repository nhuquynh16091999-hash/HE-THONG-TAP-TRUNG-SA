"""
Tests for EU Shipment FFM Sync modules.

Covers:
- parse_return_ref()
- extract_dates_from_history()
- determine_terminal_status()
- BGN → EUR conversion math
"""
import pytest
from datetime import datetime

# Add project root to path for imports
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sync.stramark.eu_shipment_parser import (
    parse_return_ref,
    extract_dates_from_history,
    determine_terminal_status,
)


# ═══ parse_return_ref tests ═══

class TestParseReturnRef:
    def test_normal_order_id(self):
        order_id, is_return = parse_return_ref("4521")
        assert order_id == "4521"
        assert is_return is False

    def test_return_pattern(self):
        order_id, is_return = parse_return_ref(
            "3662 Returned WB The New is: 382314730"
        )
        assert order_id == "3662"
        assert is_return is True

    def test_return_pattern_case_insensitive(self):
        order_id, is_return = parse_return_ref(
            "1234 returned wb something"
        )
        assert order_id == "1234"
        assert is_return is True

    def test_empty_string(self):
        order_id, is_return = parse_return_ref("")
        assert order_id is None
        assert is_return is False

    def test_none_input(self):
        order_id, is_return = parse_return_ref(None)
        assert order_id is None
        assert is_return is False

    def test_numeric_with_spaces(self):
        order_id, is_return = parse_return_ref("  5678  ")
        assert order_id == "5678"
        assert is_return is False

    def test_mixed_alphanumeric(self):
        order_id, is_return = parse_return_ref("123ABC")
        assert order_id == "123"
        assert is_return is False

    def test_integer_input(self):
        order_id, is_return = parse_return_ref(9999)
        assert order_id == "9999"
        assert is_return is False


# ═══ extract_dates_from_history tests ═══

class TestExtractDatesFromHistory:
    def test_empty_history(self):
        dates = extract_dates_from_history(None)
        assert dates["created"] is None
        assert dates["delivered"] is None
        assert dates["returned"] is None

    def test_created_status(self):
        history = [
            {"STATUS": "Order created", "DATE": "2026-03-01 10:00:00"}
        ]
        dates = extract_dates_from_history(history)
        assert dates["created"] is not None
        assert isinstance(dates["created"], datetime)

    def test_delivered_status(self):
        history = [
            {"STATUS": "Package delivered", "DATE": "2026-03-05 14:30:00"}
        ]
        dates = extract_dates_from_history(history)
        assert dates["delivered"] is not None

    def test_returned_status(self):
        history = [
            {"STATUS": "Sent back to sender", "DATE": "2026-03-07 09:00:00"}
        ]
        dates = extract_dates_from_history(history)
        assert dates["returned"] is not None

    def test_full_lifecycle(self):
        history = {"data": [
            {"STATUS": "Shipment registered", "DATE": "2026-03-01 10:00:00"},
            {"STATUS": "In transit", "DATE": "2026-03-02 08:00:00"},
            {"STATUS": "Package delivered to recipient", "DATE": "2026-03-03 15:00:00"},
        ]}
        dates = extract_dates_from_history(history)
        assert dates["created"] is not None
        assert dates["delivered"] is not None
        assert dates["returned"] is None

    def test_european_date_format(self):
        history = [
            {"STATUS": "accepted", "DATE": "01.03.2026 10:00:00"}
        ]
        dates = extract_dates_from_history(history)
        assert dates["created"] is not None


# ═══ determine_terminal_status tests ═══

class TestDetermineTerminalStatus:
    def test_empty_history(self):
        assert determine_terminal_status([]) == "Unknown"
        assert determine_terminal_status(None) == "Unknown"

    def test_delivered(self):
        history = [
            {"STATUS": "Shipment registered"},
            {"STATUS": "In transit"},
            {"STATUS": "Package delivered"},
        ]
        assert determine_terminal_status(history) == "Delivered"

    def test_returned(self):
        history = [
            {"STATUS": "Shipment registered"},
            {"STATUS": "In transit"},
            {"STATUS": "Returned to sender"},
        ]
        assert determine_terminal_status(history) == "Returned"

    def test_returned_overrides_delivered(self):
        """If both delivered and returned appear, returned wins."""
        history = [
            {"STATUS": "Package delivered"},
            {"STATUS": "Returned back"},
        ]
        assert determine_terminal_status(history) == "Returned"

    def test_shipped_only(self):
        history = [
            {"STATUS": "Shipment registered"},
            {"STATUS": "In transit"},
        ]
        assert determine_terminal_status(history) == "Shipped"

    def test_processing_only(self):
        history = [{"STATUS": "Order accepted"}]
        assert determine_terminal_status(history) == "Processing"

    def test_received_means_delivered(self):
        history = [{"STATUS": "Parcel received by recipient"}]
        assert determine_terminal_status(history) == "Delivered"

    def test_back_means_returned(self):
        history = [{"STATUS": "Sent back to warehouse"}]
        assert determine_terminal_status(history) == "Returned"


# ═══ BGN to EUR conversion tests ═══

class TestBgnToEurConversion:
    """Test the fixed BGN→EUR conversion rate."""

    BGN_TO_EUR_RATE = 1.95583

    def test_7_bgn_equals_358_eur(self):
        """7.00 BGN ≈ 3.58 EUR (most common shipment cost)."""
        eur = round(7.00 / self.BGN_TO_EUR_RATE, 2)
        assert eur == 3.58

    def test_6_bgn(self):
        """6.00 BGN ≈ 3.07 EUR (return shipment cost)."""
        eur = round(6.00 / self.BGN_TO_EUR_RATE, 2)
        assert eur == 3.07

    def test_8_bgn(self):
        """8.00 BGN ≈ 4.09 EUR (heavier shipment)."""
        eur = round(8.00 / self.BGN_TO_EUR_RATE, 2)
        assert eur == 4.09

    def test_vat_application(self):
        """7 BGN excl VAT → 3.58 EUR → 4.29 EUR incl 20% VAT."""
        vat_rate = 0.20
        price_eur = 7.00 / self.BGN_TO_EUR_RATE
        price_incl_vat = round(price_eur * (1 + vat_rate), 2)
        assert price_incl_vat == 4.29

    def test_zero_price(self):
        """Zero price stays zero after conversion."""
        eur = 0.0 / self.BGN_TO_EUR_RATE
        assert eur == 0.0
