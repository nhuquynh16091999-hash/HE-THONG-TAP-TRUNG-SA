"""
sync/core/meta_client.py — Meta Marketing API client cho TALPHA.

15 tài khoản QC, App "Talpha Dashboard" (ID: 933783286371848).
Token: System User token "talpha-sync" (type SYSTEM_USER, expires_at=0 — KHÔNG hết hạn),
cấp 20/08/2026. Bản cũ (app "Talpha Post" 1492490978955925) là token NGƯỜI DÙNG, hết hạn
60 ngày → chết 17/08/2026 làm sync ads đứng 9 ngày. Đổi token phải sửa CẢ 3 nơi:
repo .env, ~/talpha_reports/runtime/.env, và .env trên server 169.58.33.8.

Usage:
  from sync.core.meta_client import MetaAdsClient
  client = MetaAdsClient(access_token=os.environ["TALPHA_META_ACCESS_TOKEN"])
  rows = client.fetch_ads_insights(account_id="act_832444553250352", date_start="2026-06-01", date_stop="2026-06-19")
"""
import time, logging, requests
from typing import Optional

log = logging.getLogger(__name__)

META_API_BASE = "https://graph.facebook.com"
META_API_VERSION = "v21.0"
META_SLEEP_BETWEEN_REQUESTS = 1.0   # giãn nhịp để tránh rate limit account lớn
META_MAX_RETRIES = 4
META_TIMEOUT = 90                   # trước là 30/60 → account lớn (nhiều campaign) hay timeout
META_RATE_LIMIT_SLEEP = 60         # giây, chờ khi Meta báo "Application request limit reached"
# Mã lỗi Meta = rate/throttle limit → cần CHỜ rồi thử lại, KHÔNG bỏ account
RATE_LIMIT_CODES = {4, 17, 32, 613, 80000, 80003, 80004, 80014}


class MetaFetchError(Exception):
    """Fetch 1 account thất bại hẳn (timeout/limit hết retry) — để caller KHÔNG ghi 0 đè."""


def _is_rate_limit(err: dict) -> bool:
    if not err:
        return False
    code = err.get("code")
    msg = str(err.get("message", "")).lower()
    return code in RATE_LIMIT_CODES or "request limit" in msg or "reduce the amount of data" in msg

# 8 tài khoản QC TALPHA
TALPHA_AD_ACCOUNTS = [
    {"id": "act_832444553250352",  "name": "Mỹ phẩm 3 5/6/2026"},
    {"id": "act_1990279368211651", "name": "Mỹ phẩm 2 6/5/2026"},
    {"id": "act_1146444450958264", "name": "Mỹ phẩm 5/6/2026"},
    {"id": "act_416558701342048",  "name": "Tiểu Alpha 1"},
    {"id": "act_4382396978703883", "name": "Trang sức 27/04/2026"},
    {"id": "act_869269479518459",  "name": "Mai 01"},
    {"id": "act_1670165974333671", "name": "Nhật Bản - 03"},
    {"id": "act_1284981146939856", "name": "Sỹ Lộc 03"},
    {"id": "act_1543721207473858", "name": "Trung Đông múi h Mỹ"},
    {"id": "act_1380444643991154", "name": "Trang sức 15/6/2026"},
    {"id": "act_1343764530945320", "name": "Đài 18-05-2026"},
    {"id": "act_2490459691392269", "name": "Sỹ Anh Dubai 01"},
    {"id": "act_2071538856772150", "name": "Sỹ Anh Mỹ 03"},
    {"id": "act_1341405590946084", "name": "Sỹ Anh Kuwait 02"},
    {"id": "act_1669476730831714", "name": "Sỹ Anh Saudi 04"},
]

# Fields mặc định khi fetch insights
DEFAULT_FIELDS = [
    "account_id", "account_name",
    "campaign_id", "campaign_name",
    "adset_id", "adset_name",
    "ad_id", "ad_name",
    "spend", "impressions", "clicks",
    "actions",
]


class MetaAdsClient:
    """Client cho Meta Marketing API."""

    def __init__(self, access_token: str, api_version: str = META_API_VERSION):
        self.token = access_token
        self.base = f"{META_API_BASE}/{api_version}"

    def _request(self, url: str, params: Optional[dict] = None) -> dict:
        """GET có retry + backoff. Dùng cho CẢ trang đầu và trang phân trang (next_url).

        - Lỗi mạng/timeout → backoff mũ, thử lại.
        - Meta rate limit ("Application request limit reached") → CHỜ lâu (60s×lần) rồi thử lại,
          KHÔNG bỏ account.
        - Hết retry → raise MetaFetchError (caller sẽ retry account / báo lỗi, KHÔNG ghi 0 đè).
        """
        last_err = None
        for attempt in range(META_MAX_RETRIES):
            try:
                resp = requests.get(url, params=params, timeout=META_TIMEOUT)
                # HTTP 429 = throttle
                if resp.status_code == 429:
                    wait = META_RATE_LIMIT_SLEEP * (attempt + 1)
                    log.warning(f"  Meta HTTP 429 → chờ {wait}s (lần {attempt+1}/{META_MAX_RETRIES})")
                    last_err = "HTTP 429"
                    time.sleep(wait)
                    continue
                data = resp.json()
                # Meta có thể trả 200 kèm error body cho rate limit
                if isinstance(data, dict) and data.get("error"):
                    if _is_rate_limit(data["error"]):
                        wait = META_RATE_LIMIT_SLEEP * (attempt + 1)
                        log.warning(f"  Meta rate limit: {data['error'].get('message')} → chờ {wait}s (lần {attempt+1})")
                        last_err = data["error"].get("message")
                        time.sleep(wait)
                        continue
                    return data  # lỗi khác (không phải rate) → trả để caller xử lý
                resp.raise_for_status()
                return data
            except requests.RequestException as e:
                last_err = e
                wait = 2 ** attempt
                log.warning(f"  Meta request lần {attempt+1}/{META_MAX_RETRIES}: {e} → chờ {wait}s")
                time.sleep(wait)
        raise MetaFetchError(f"Meta request thất bại sau {META_MAX_RETRIES} lần: {last_err}")

    def _get(self, path: str, params: dict) -> dict:
        """Tương thích ngược — wrapper quanh _request."""
        params = dict(params or {})
        params["access_token"] = self.token
        return self._request(f"{self.base}/{path}", params)

    def fetch_ads_insights(
        self,
        account_id: str,
        date_start: str,
        date_stop: str,
        fields: Optional[list[str]] = None,
        level: str = "ad",
    ) -> list[dict]:
        """Fetch ads insights cho 1 tài khoản trong date range.

        Returns: list của raw insight rows (chưa quy đổi tiền).
        Note: spend từ Meta API là USD. Đã quy đổi sang VND ở bước transform.
        """
        fields = fields or DEFAULT_FIELDS
        params = {
            "fields": ",".join(fields),
            "time_range": f'{{"since":"{date_start}","until":"{date_stop}"}}',
            "time_increment": 1,   # tách theo NGÀY — nếu thiếu, Meta gộp cả range thành 1 dòng/ad (date = ngày đầu)
            "level": level,
            "limit": 500,
        }
        rows = []
        params["access_token"] = self.token
        # Trang đầu; các trang sau theo paging.next. CẢ HAI qua _request (retry + rate-limit backoff)
        # để account lớn không bị mất trang giữa chừng.
        data = self._request(f"{self.base}/{account_id}/insights", params)

        while True:
            if isinstance(data, dict) and data.get("error"):
                # rate limit đã được _request tự chờ+thử lại; tới đây là lỗi KHÁC → fail hẳn account.
                raise MetaFetchError(f"[{account_id}] Meta error: {data['error']}")

            for row in data.get("data", []):
                rows.append(row)

            next_url = data.get("paging", {}).get("next")
            if not next_url:
                break
            time.sleep(META_SLEEP_BETWEEN_REQUESTS)
            data = self._request(next_url)  # next_url đã kèm access_token; retry bên trong

        log.info(f"  [{account_id}] Fetched {len(rows)} insight rows ({date_start} → {date_stop})")
        return rows

    def fetch_all_accounts(
        self,
        date_start: str,
        date_stop: str,
        account_ids: Optional[list[dict]] = None,
    ) -> list[dict]:
        """Fetch insights từ tất cả tài khoản QC.

        Args:
            date_start, date_stop: YYYY-MM-DD
            account_ids: list[{"id": "act_...", "name": "..."}], default = 8 TALPHA accounts

        Returns: list rows đã gộp từ tất cả accounts.
        """
        accounts = account_ids or TALPHA_AD_ACCOUNTS
        all_rows = []

        for acc in accounts:
            log.info(f"  Fetching: {acc['name']} ({acc['id']})")
            rows = self.fetch_ads_insights(acc["id"], date_start, date_stop)
            all_rows.extend(rows)
            time.sleep(META_SLEEP_BETWEEN_REQUESTS)

        log.info(f"  Total Meta rows: {len(all_rows)} from {len(accounts)} accounts")
        return all_rows

    def transform_to_bq_row(
        self, row: dict, account_name: str = "", usd_to_vnd: float = 25700
    ) -> dict:
        """Transform 1 insight row → BQ format.

        Note: spend từ Meta là USD → nhân usd_to_vnd để ra VND.
        """
        def get_action(actions: list, action_type: str) -> int:
            for a in (actions or []):
                if a.get("action_type") == action_type:
                    return int(float(a.get("value", 0)))
            return 0

        actions = row.get("actions", [])
        spend_usd = float(row.get("spend", 0) or 0)

        return {
            "date":             row.get("date_start", ""),
            "account_id":       row.get("account_id", ""),
            "account_name":     row.get("account_name", account_name),
            "campaign_id":      row.get("campaign_id", ""),
            "campaign_name":    row.get("campaign_name", ""),
            "adset_id":         row.get("adset_id", ""),
            "adset_name":       row.get("adset_name", ""),
            "ad_id":            int(row.get("ad_id", 0) or 0),  # INT64 trong BQ
            "ad_name":          row.get("ad_name", ""),
            "spend":            round(spend_usd * usd_to_vnd, 0),  # Quy đổi → VND
            "spend_usd":        spend_usd,
            "impressions":      int(row.get("impressions", 0) or 0),
            "clicks":           int(row.get("clicks", 0) or 0),
            "messaging_conversations_started": get_action(actions, "onsite_conversion.messaging_conversation_started_7d"),
            "purchases":        get_action(actions, "purchase"),
        }
