"""
Inventory API — BOTCAKE AI webhook endpoint.

BOTCAKE calls GET /api/inventory/check?sku=<sku> at Stage 6 of the
conversation flow to verify product availability before closing an order.

Response drives the conversation routing:
  in_stock=true  → AI proceeds to Stage 7a (closing)
  in_stock=false → AI routes to Stage 7b (out-of-stock alternatives)
"""
from __future__ import annotations

import logging
from typing import Any, Dict

from fastapi import APIRouter, HTTPException, Query

from faos_brain.config import settings
from faos_brain.services.poscake_inventory import PoscakeInventoryService

log = logging.getLogger("faos.inventory.api")

router = APIRouter(prefix="/api/inventory", tags=["Inventory — BOTCAKE Webhook"])


@router.get("/check")
async def check_inventory(
    sku: str = Query(..., description="Product SKU to check stock for"),
) -> Dict[str, Any]:
    """
    Check real-time inventory for a product SKU from Poscake.

    Called by BOTCAKE AI as a webhook before Stage 6 (product offer).

    Returns:
        ```json
        {
          "sku": "TUONG_PHAT_001",
          "name": "Tượng Phật Di Lặc",
          "in_stock": true,
          "qty": 15,
          "alternatives": []
        }
        ```
        When out of stock, `alternatives` contains up to 2 in-stock products.
    """
    if not settings.botcake_poscake_api_key or not settings.botcake_poscake_shop_id:
        raise HTTPException(
            status_code=503,
            detail=(
                "Inventory service not configured. "
                "Set BOTCAKE_POSCAKE_API_KEY and BOTCAKE_POSCAKE_SHOP_ID in .env"
            ),
        )

    svc = PoscakeInventoryService(
        api_key=settings.botcake_poscake_api_key,
        shop_id=settings.botcake_poscake_shop_id,
    )

    result = await svc.check_stock(sku)

    if not result["in_stock"]:
        result["alternatives"] = await svc.get_alternatives(exclude_sku=sku, limit=2)
    else:
        result["alternatives"] = []

    log.info(f"Inventory check: sku={sku} in_stock={result['in_stock']} qty={result['qty']}")
    return result
