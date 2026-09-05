"""
CAPI Transform — SHA256 hashing and normalization for Meta CAPI.

Split from capi_push.py for maintainability.
Contains:
    - hash_field(): SHA256 hash a single PII field
    - normalize_phone(): Romanian phone normalization + hash
    - remove_diacritics(): Strip diacritics (ș→s, ț→t)
    - hash_user_data(): Build complete hashed user_data object
    - build_event(): Build a single CAPI Purchase event payload
"""

from __future__ import annotations

import hashlib
import re
import unicodedata
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

# ═══════════════════════════════════════════
# SHA256 Hash Helpers
# ═══════════════════════════════════════════


def hash_field(value: str) -> Optional[str]:
    """
    SHA256 hash a single field per Meta CAPI requirements.

    Rules (Doc 02 §5.3):
    - Trim whitespace
    - Convert to lowercase
    - SHA256 hex digest

    Args:
        value: Raw field value.

    Returns:
        SHA256 hex string, or None if empty.
    """
    if not value or not value.strip():
        return None
    cleaned = value.strip().lower()
    return hashlib.sha256(cleaned.encode("utf-8")).hexdigest()


def normalize_phone(phone: str) -> Optional[str]:
    """
    Normalize phone number for Meta CAPI hashing.

    Rules (Doc 02 §5.3):
    - Remove +, spaces, dashes, parentheses
    - Remove leading 0 for Romanian numbers → prefix with 40
    - Must be digits only before hashing

    Examples:
        "+40 723 456 789" → "40723456789" → SHA256
        "0723456789"      → "40723456789" → SHA256
    """
    if not phone or not phone.strip():
        return None

    # Remove all non-digit characters
    digits = re.sub(r"\D", "", phone.strip())

    if not digits:
        return None

    # Romanian numbers: remove leading 0, prefix with 40
    if digits.startswith("0") and len(digits) == 10:
        digits = "40" + digits[1:]

    return hashlib.sha256(digits.encode("utf-8")).hexdigest()


def remove_diacritics(text: str) -> str:
    """Remove diacritics from text (ș→s, ț→t, ă→a, â→a, î→i)."""
    nfkd = unicodedata.normalize("NFKD", text)
    return "".join(c for c in nfkd if not unicodedata.combining(c))


# ═══════════════════════════════════════════
# User Data Hashing
# ═══════════════════════════════════════════


def hash_user_data(order: Dict[str, Any]) -> Dict[str, Any]:
    """
    Build hashed user_data object per Meta CAPI spec.

    All PII fields are SHA256-hashed. Phone has special normalization.
    City has diacritics removed.

    Args:
        order: Raw order dict with PII fields.

    Returns:
        Dict ready for CAPI user_data payload.
    """
    # Split customer_name into first/last
    name_parts = (order.get("customer_name", "") or "").strip().split(maxsplit=1)
    first_name = name_parts[0] if name_parts else ""
    last_name = name_parts[1] if len(name_parts) > 1 else ""

    # City: remove diacritics before hashing
    city = remove_diacritics(order.get("customer_city", "") or "")

    # Country: ISO 2-letter lowercase
    country = (order.get("customer_country_code", "") or "").strip().lower()

    user_data: Dict[str, Any] = {}

    em = hash_field(order.get("customer_email", ""))
    if em:
        user_data["em"] = [em]

    ph = normalize_phone(order.get("customer_phone", ""))
    if ph:
        user_data["ph"] = [ph]

    fn = hash_field(first_name)
    if fn:
        user_data["fn"] = [fn]

    ln = hash_field(last_name)
    if ln:
        user_data["ln"] = [ln]

    ct = hash_field(city)
    if ct:
        user_data["ct"] = [ct]

    co = hash_field(country)
    if co:
        user_data["country"] = [co]

    # External ID = order_id hashed
    ext_id = hash_field(order.get("order_id", ""))
    if ext_id:
        user_data["external_id"] = [ext_id]

    return user_data


# ═══════════════════════════════════════════
# Build CAPI Event Payload
# ═══════════════════════════════════════════


def build_event(order: Dict[str, Any]) -> Dict[str, Any]:
    """
    Build a single CAPI Purchase event from an order.

    Args:
        order: Order dict with PII fields.

    Returns:
        CAPI event dict ready for POST.
    """
    content_ids = order.get("content_ids", [])
    if isinstance(content_ids, str):
        content_ids = [cid.strip() for cid in content_ids.split(",") if cid.strip()]

    return {
        "event_name": "Purchase",
        "event_time": order.get("event_time", int(datetime.now(timezone.utc).timestamp())),
        "event_id": order["order_id"],  # Dedup key
        "action_source": "website",
        "user_data": hash_user_data(order),
        "custom_data": {
            "value": order.get("value", 0),
            "currency": order.get("currency", "RON"),
            "content_ids": content_ids,
            "content_type": "product",
            "order_id": order["order_id"],
            "num_items": order.get("num_items", 1),
        },
    }
