"""
sync/core/pos_client.py — Poscake POS API client.

Hỗ trợ 6 shops GCC của TALPHA:
  SA (Saudi) · AE (UAE) · KW (Kuwait) · OM (Oman) · QA (Qatar) · BH (Bahrain)

Usage:
  from sync.core.pos_client import PoscakeClient
  client = PoscakeClient(api_key="...", shop_id="1635200759", shop_label="AE")
  orders, items = client.fetch_orders(window_start="2026-06-01T00:00:00")
"""
import time, json, logging, requests
from typing import Optional
from sync.core.business_rules import STATUS_CATEGORY_MAP, should_count_as_order

log = logging.getLogger(__name__)

POS_API_URL = "https://pos.pages.fm/api/v1"
# Tham số phân trang đúng tên là `page_size`. Code cũ gửi `per_page` — POS BỎ QUA
# và luôn trả 10 đơn/request (probe 04/08: page_size=100 → 100 đơn, per_page=100 → 10).
# 100 đơn/request = ít hơn 10 lần số request, đủ nhanh để bỏ hẳn Smart Stop.
POS_PAGE_SIZE = 100
POS_SLEEP_BETWEEN_PAGES = 0.3  # seconds
POS_MAX_RETRIES = 5            # số lần thử lại khi gặp 500/timeout/reset (SA hay chết giữa chừng)
POS_RETRY_BACKOFF = 3.0        # giây × số lần thử


class PosFetchError(Exception):
    """Fetch 1 shop thất bại giữa chừng — caller KHÔNG được ghi đè dữ liệu bằng bộ thiếu.
    (Bug 06/07: SA chết ở page 11 → bảng sale_order bị truncate còn 100/2210 đơn → Sheet sai đơn hàng loạt.)"""


class PoscakeClient:
    """Client cho một Poscake shop."""

    def __init__(
        self,
        api_key: str,
        shop_label: str,
        shop_id: str = "",
        currency: str = "AED",
        sync_time: str = "",
    ):
        self.api_key = api_key
        self.shop_label = shop_label
        self.shop_id = shop_id or self._discover_shop_id()
        self.currency = currency
        self.sync_time = sync_time

    def _discover_shop_id(self) -> str:
        """Auto-discover shop_id từ API key."""
        try:
            resp = requests.get(
                f"{POS_API_URL}/shops",
                params={"api_key": self.api_key},
                timeout=15,
            )
            body = resp.json()
            # Endpoint /shops trả về khoá "shops", KHÔNG phải "data" như các
            # endpoint khác của cùng API. Bản trước chỉ đọc "data" nên luôn dò
            # ra rỗng và báo "shop_id NOT FOUND", trong khi key hoàn toàn tốt.
            shops = body.get("shops") or body.get("data") or []
            if shops:
                sid = str(shops[0].get("id", ""))
                log.info(f"  [{self.shop_label}] Discovered shop_id={sid} ({shops[0].get('name')})")
                return sid
            log.warning(f"  [{self.shop_label}] /shops không trả shop nào: {str(body)[:120]}")
        except Exception as e:
            log.warning(f"  [{self.shop_label}] Shop ID discovery failed: {e}")
        return ""

    def fetch_orders(
        self, window_start: Optional[str] = None
    ) -> tuple[list[dict], list[dict]]:
        """Fetch mọi đơn được TẠO từ `window_start` trở đi.

        Điểm dừng đi ĐÚNG chiều sắp xếp thật của feed: POS trả đơn theo
        `inserted_at` giảm dần (probe 04/08 xác nhận trên cả trang 100 đơn), nên
        gặp đơn `inserted_at < window_start` là chắc chắn phía sau không còn đơn nào
        mới hơn → dừng an toàn.

        Smart Stop cũ dừng theo `updated_at` — giả định feed sắp theo updated_at, SAI.
        Đơn COD tạo lâu ngày mới giao xong nằm sâu ở trang sau nên bị cắt mất, mỗi
        vòng cắt một chỗ khác nhau (X1).

        Args:
            window_start: mốc `inserted_at` sớm nhất cần lấy (ISO string).
                          None = kéo toàn bộ lịch sử (dùng cho backfill).

        Returns:
            (orders, items): list các order rows và item rows đã chuẩn hóa.
        """
        if not self.api_key:
            log.warning(f"  [{self.shop_label}] No API key — skip")
            return [], []
        if not self.shop_id:
            log.error(f"  [{self.shop_label}] No shop_id — skip")
            return [], []

        log.info(f"  [{self.shop_label}] Fetching orders (shop={self.shop_id}, {self.currency})...")
        all_orders, all_items = [], []
        page = 1

        while True:
            data = self._fetch_page_with_retry(page)
            if data is None:
                # Hết retry mà vẫn lỗi → FAIL HẲN shop này. Trước đây `break` trả bộ THIẾU
                # âm thầm → caller truncate bảng bằng dữ liệu cụt (mất ~2000 đơn SA 06/07).
                raise PosFetchError(
                    f"[{self.shop_label}] fetch chết ở page {page} sau {POS_MAX_RETRIES} lần thử "
                    f"(đã gom {len(all_orders)} đơn — KHÔNG dùng bộ thiếu này)"
                )

            orders = data.get("data", [])
            if not orders:
                break

            # Feed sắp theo inserted_at DESC → cắt tại đơn đầu tiên cũ hơn cửa sổ.
            keep, reached_end = self._trim_to_window(orders, window_start)
            for o in keep:
                order_row, item_rows = self._normalize_order(o)
                all_orders.append(order_row)
                all_items.extend(item_rows)

            if reached_end:
                log.info(
                    f"  [{self.shop_label}] Hết cửa sổ tại page {page} "
                    f"(đơn cũ hơn {window_start}) — {len(all_orders)} đơn"
                )
                break

            if page % 20 == 0:
                log.info(f"    [{self.shop_label}] Page {page}: {len(all_orders)} orders")

            if len(orders) < POS_PAGE_SIZE:
                break
            page += 1
            time.sleep(POS_SLEEP_BETWEEN_PAGES)

        log.info(f"  [{self.shop_label}] Done: {len(all_orders)} orders, {len(all_items)} items")
        return all_orders, all_items

    def _fetch_page_with_retry(self, page: int) -> Optional[dict]:
        """Fetch 1 page orders với retry cho 500/timeout (E2).

        Trả về dict JSON nếu thành công, None nếu hết retry vẫn lỗi.
        Lỗi 4xx (trừ 429) coi là vĩnh viễn → không retry.
        """
        for attempt in range(1, POS_MAX_RETRIES + 1):
            try:
                resp = requests.get(
                    f"{POS_API_URL}/shops/{self.shop_id}/orders",
                    params={
                        "api_key": self.api_key,
                        "page": page,
                        "page_size": POS_PAGE_SIZE,  # KHÔNG phải per_page — POS bỏ qua per_page
                        "include_items": 1,          # trả về items[] trong mỗi order
                    },
                    timeout=60,
                )
                # 500/502/503/504/429 = lỗi tạm thời → retry
                if resp.status_code in (500, 502, 503, 504, 429):
                    wait = POS_RETRY_BACKOFF * attempt
                    log.warning(
                        f"  [{self.shop_label}] Page {page} HTTP {resp.status_code} "
                        f"(thử {attempt}/{POS_MAX_RETRIES}) — chờ {wait:.1f}s rồi thử lại"
                    )
                    time.sleep(wait)
                    continue
                resp.raise_for_status()
                return resp.json()
            except requests.exceptions.RequestException as e:
                # timeout / connection error → retry
                wait = POS_RETRY_BACKOFF * attempt
                log.warning(
                    f"  [{self.shop_label}] Page {page} lỗi mạng (thử {attempt}/{POS_MAX_RETRIES}): {e} "
                    f"— chờ {wait:.1f}s"
                )
                time.sleep(wait)
        return None

    def _trim_to_window(
        self, orders: list[dict], window_start: Optional[str]
    ) -> tuple[list[dict], bool]:
        """Cắt trang theo cửa sổ ngày TẠO. Trả (đơn giữ lại, đã chạm đáy cửa sổ chưa).

        Feed sắp theo `inserted_at` giảm dần nên chỉ cần tìm đơn đầu tiên cũ hơn mốc.
        Đơn thiếu `inserted_at` thì giữ lại — thà thừa còn hơn bỏ sót.
        """
        if not window_start:
            return orders, False
        keep = []
        for o in orders:
            ins = str(o.get("inserted_at", "") or "")
            if ins and ins < window_start:
                return keep, True
            keep.append(o)
        return keep, False

    def _normalize_order(self, o: dict) -> tuple[dict, list[dict]]:
        """Chuẩn hóa 1 order dict từ Poscake API → BQ row format."""
        marketer_raw = o.get("marketer")
        marketer_str = (
            json.dumps(marketer_raw, ensure_ascii=False)
            if isinstance(marketer_raw, dict)
            else str(marketer_raw or "")
        )
        status_name = str(o.get("status_name", ""))
        category, sub = STATUS_CATEGORY_MAP.get(status_name, ("UNKNOWN", "unknown"))

        order_row = {
            "id":              str(o.get("id", "")),
            "shop_id":         str(o.get("shop_id", self.shop_id)),
            "shop_label":      self.shop_label,
            "status":          str(o.get("status", 0)),
            "status_name":     status_name,
            "status_category": category,
            "status_sub":      sub,
            "total_price":     float(o.get("total_price", 0) or 0),
            "shipping_fee":    float(o.get("shipping_fee", 0) or 0),
            "cod":             float(o.get("cod", 0) or 0),
            "total_discount":  float(o.get("total_discount", 0) or 0),
            "partner_fee":     float(o.get("partner_fee", 0) or 0),
            "return_fee":      float(o.get("return_fee", 0) or 0),
            "surcharge":       float(o.get("surcharge", 0) or 0),
            "money_to_collect":float(o.get("money_to_collect", 0) or 0),
            "total_quantity":  str(o.get("total_quantity", 0) or 0),
            "marketer":        marketer_str,
            "ad_id":           str(o.get("ad_id", "") or ""),
            "adset_id":        str(o.get("adset_id", "") or ""),
            "ads_source":      str(o.get("ads_source", "") or ""),
            "page_id":         str(o.get("page_id", "") or ""),
            "post_id":         str(o.get("post_id", "") or ""),
            "p_utm_source":    str(o.get("p_utm_source", "") or ""),
            "p_utm_campaign":  str(o.get("p_utm_campaign", "") or ""),
            "p_utm_medium":    str(o.get("p_utm_medium", "") or ""),
            "p_utm_content":   str(o.get("p_utm_content", "") or ""),
            "p_utm_term":      str(o.get("p_utm_term", "") or ""),
            "p_utm_id":        str(o.get("p_utm_id", "") or ""),
            # Loại tiền THẬT của đơn, không phải của shop. Gán cứng self.currency
            # là dán nhãn TWD lên cả đơn ghi bằng VND — shop Đài đang lẫn 71 đơn
            # VND (650.000–1.000.000) giữa 200 đơn TWD (749–1.399). Dán nhãn sai
            # thì bộ lọc ở talpha_sync không nhận ra, đơn VND lọt vào rồi bị nhân
            # tỷ giá 800 như thể là TWD.
            "order_currency":  str(o.get("order_currency") or self.currency),
            "customer_id":     str((o.get("customer") or {}).get("id", "")),
            "customer_name":   str((o.get("customer") or {}).get("name", "")),
            "bill_full_name":  str(o.get("bill_full_name", "") or ""),
            "bill_phone_number": str(o.get("bill_phone_number", "") or ""),
            "shipping_address":  str((o.get("shipping_address") or {}).get("full_address", "") or ""),
            "shipping_province": str((o.get("shipping_address") or {}).get("province_name", "") or ""),
            "shipping_district": str((o.get("shipping_address") or {}).get("district_name", "") or ""),
            "partner":         str(o.get("partner", "") or ""),
            "warehouse_id":    str(o.get("warehouse_id", "") or ""),
            "tracking_link":   str(o.get("tracking_link", "") or ""),
            "inserted_at":     str(o.get("inserted_at", "") or ""),
            "updated_at":      str(o.get("updated_at", "") or ""),
            "time_send_partner": str(o.get("time_send_partner", "") or ""),
            "estimate_delivery_date": str(o.get("estimate_delivery_date", "") or ""),
            "note":            str(o.get("note", "") or ""),
            "tags":            str(o.get("tags", "") or ""),
            "order_link":      str(o.get("order_link", "") or ""),
            "sync_time":       self.sync_time,
        }

        item_rows = []
        for item in (o.get("items", []) or []):
            item_rows.append({
                "item_id":         str(item.get("id", "")),
                "order_id":        str(o.get("id", "")),
                "shop_id":         str(o.get("shop_id", self.shop_id)),
                "shop_name":       str(o.get("shop_name", "")),
                "project_id":      f"talpha_{self.shop_label.lower()}",
                "product_id":      str(item.get("product_id", "")),
                "variation_id":    str(item.get("variation_id", "")),
                # Pancake lồng tên/giá trong variation_info (top-level không có → toàn rỗng/0)
                "product_name":    str((item.get("variation_info") or {}).get("name", "") or item.get("product_name", "") or ""),
                "variation_name":  str((item.get("variation_info") or {}).get("detail", "") or item.get("variation_name", "") or ""),
                "barcode":         str((item.get("variation_info") or {}).get("barcode", "") or item.get("barcode", "") or ""),
                "quantity":        int(item.get("quantity", 0) or 0),
                "return_quantity": int(item.get("return_quantity", 0) or 0),
                "returned_count":  int(item.get("returned_count", 0) or 0),
                "returning_quantity": int(item.get("returning_quantity", 0) or 0),
                "retail_price":    float((item.get("variation_info") or {}).get("retail_price", 0) or item.get("retail_price", 0) or 0),
                "discount_each_product": float(item.get("discount_each_product", 0) or 0),
                "total_discount":  float(item.get("total_discount", 0) or 0),
                "same_price_discount": float(item.get("same_price_discount", 0) or 0),
                "avg_imported_price": float((item.get("variation_info") or {}).get("last_imported_price", 0) or (item.get("variation_info") or {}).get("avg_price", 0) or item.get("avg_imported_price", 0) or 0),
                "is_bonus_product": str(item.get("is_bonus_product", "false")),
                "is_composite":    str(item.get("is_composite", "false")),
                "is_wholesale":    str(item.get("is_wholesale", "false")),
                "order_inserted_at": str(o.get("inserted_at", "") or ""),
                "sync_time":       self.sync_time,
            })

        return order_row, item_rows
