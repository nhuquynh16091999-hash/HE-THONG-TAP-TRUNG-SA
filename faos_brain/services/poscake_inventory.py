"""
PoscakeInventoryService — Real-time stock check from Poscake API.

Used by BOTCAKE AI webhook to verify product availability before closing orders.

Poscake API notes (from existing sync code):
  - Endpoint: /shops/{SHOP_ID}/products
  - Stock field: variant.variations_warehouses[].actual_remain_quantity
    (NOT stock_quantity — that field is always None)
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List

import httpx

log = logging.getLogger("faos.inventory")

POSCAKE_API_URL = "https://pos.pages.fm/api/v1"


class PoscakeInventoryService:
    """Check real-time product stock from Poscake API."""

    def __init__(self, api_key: str, shop_id: str, timeout: int = 10) -> None:
        self.api_key = api_key
        self.shop_id = shop_id
        self.timeout = timeout

    async def _fetch_products(self) -> List[Dict[str, Any]]:
        """Fetch all products from Poscake API (paginated, 50/page)."""
        all_products: List[Dict[str, Any]] = []
        page = 1
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            while True:
                resp = await client.get(
                    f"{POSCAKE_API_URL}/shops/{self.shop_id}/products",
                    params={"api_token": self.api_key, "page": page, "limit": 50},
                )
                resp.raise_for_status()
                data = resp.json()
                # API returns either {"products": [...]} or directly [...]
                products = data.get("products", data) if isinstance(data, dict) else data
                if not products:
                    break
                all_products.extend(products)
                page += 1
        return all_products

    def _get_stock_qty(self, product: Dict[str, Any], sku: str) -> int:
        """
        Extract actual remaining quantity for a variant matching the SKU.
        Uses variations_warehouses[].actual_remain_quantity (correct Poscake field).
        """
        for variant in product.get("variations", []):
            if variant.get("code", "") == sku:
                qty = 0
                for wh in variant.get("variations_warehouses", []):
                    qty += int(wh.get("actual_remain_quantity", 0) or 0)
                return qty
        return 0

    async def check_stock(self, sku: str) -> Dict[str, Any]:
        """
        Check stock for a specific product SKU.

        Returns:
            {sku, name, in_stock, qty}
            On API error: in_stock=False, error field included
        """
        try:
            products = await self._fetch_products()
            for product in products:
                for variant in product.get("variations", []):
                    if variant.get("code", "") == sku:
                        qty = self._get_stock_qty(product, sku)
                        return {
                            "sku": sku,
                            "name": product.get("name", ""),
                            "in_stock": qty > 0,
                            "qty": qty,
                        }
            # SKU not found in shop
            log.warning(f"SKU '{sku}' not found in Poscake shop {self.shop_id}")
            return {"sku": sku, "name": "", "in_stock": False, "qty": 0}

        except httpx.HTTPError as e:
            log.error(f"Poscake API error checking stock for '{sku}': {e}")
            return {"sku": sku, "name": "", "in_stock": False, "qty": 0, "error": str(e)}

    async def get_alternatives(
        self, exclude_sku: str, limit: int = 2
    ) -> List[Dict[str, Any]]:
        """
        Return up to `limit` in-stock products, excluding the given SKU.
        Used when the requested product is out of stock.

        Returns:
            [{sku, name, qty}, ...]
        """
        try:
            products = await self._fetch_products()
            alternatives: List[Dict[str, Any]] = []
            for product in products:
                for variant in product.get("variations", []):
                    v_sku = variant.get("code", "")
                    if v_sku == exclude_sku:
                        continue
                    qty = self._get_stock_qty(product, v_sku)
                    if qty > 0:
                        alternatives.append({
                            "sku": v_sku,
                            "name": product.get("name", ""),
                            "qty": qty,
                        })
                        if len(alternatives) >= limit:
                            return alternatives
            return alternatives

        except httpx.HTTPError as e:
            log.error(f"Poscake API error fetching alternatives: {e}")
            return []
