"""
TALPHA Business Rules — 8 quy tắc nghiệp vụ bắt buộc.

Đây là source of truth cho mọi tính toán liên quan đến doanh thu, FX, marketer,
và ghép ads↔đơn. Sai 1 rule = số liệu sai toàn bộ.

Dùng trong:
  - sync/talpha/talpha_sync.py   (ETL side)
  - tests/test_talpha_business_rules.py (tests)
  - SQL queries trong dashboard đều phải khớp với logic ở đây
"""
import json
from typing import Optional

# ─── R2: Tỷ giá FX → VND ────────────────────────────────────────────────────
# Cập nhật: 2026-02-01. Thay đổi tỷ giá → cập nhật đây + config/projects/talpha.yaml
FX_RATES_TO_VND: dict[str, float] = {
    "AE": 7010,      # AED → VND (UAE)
    "SA": 6850,      # SAR → VND (Saudi Arabia)
    "KW": 83000,     # KWD → VND (Kuwait)
    "OM": 66700,     # OMR → VND (Oman)
    "QA": 7050,      # QAR → VND (Qatar)
    "BH": 68000,     # BHD → VND (Bahrain)
    "TW": 800,       # TWD → VND (Taiwan — market test, xác nhận khi chốt shop POS Đài)
    "USD": 25700,    # USD → VND (Meta ads billing)
}

# Key có trong FX_RATES_TO_VND nhưng KHÔNG phải shop_label của đơn (chỉ dùng cho
# tiền quảng cáo) → loại khỏi CASE shop_label khi sinh SQL.
_NON_SHOP_FX_KEYS: frozenset[str] = frozenset(["USD"])

# ─── R1b: Đơn vị tiền POS lưu theo TỪNG SHOP (X13) ──────────────────────────
# Số đơn vị phụ trên 1 đơn vị tiền MÀ POS ĐANG LƯU — không phải số thập phân ISO 4217.
# 6 shop GCC nhập giá kiểu minor units (cod=9900 ⇒ 99,00 SAR) → 100.
# Shop Đài nhập NGUYÊN TWD (cod=950 ⇒ 950 TWD, verify bằng POS API 20/08) → 1.
# Trước 20/08 mọi nơi chia 100 cho mọi shop ⇒ tiền Đài tụt đúng 100 lần (AOV ra
# 8.987đ/đơn trong khi 6 market kia 0,8–1,05tr) mà không có cảnh báo nào.
# Nguồn duy nhất: config/talpha_rules.json → markets.*.pos_money_divisor.
POS_MONEY_DIVISOR: dict[str, int] = {
    "AE": 100,
    "SA": 100,
    "KW": 100,
    "OM": 100,
    "QA": 100,
    "BH": 100,
    "TW": 1,       # Đài lưu nguyên TWD
}
DEFAULT_MONEY_DIVISOR = 100  # shop mới chưa khai: giữ mặc định minor units

# Market code → display name
MARKET_NAMES: dict[str, str] = {
    "AE": "UAE",
    "SA": "Saudi",
    "KW": "Kuwait",
    "OM": "Oman",
    "QA": "Qatar",
    "BH": "Bahrain",
    "TW": "Taiwan",
}

# Poscake status_name → (category, sub_category)
STATUS_CATEGORY_MAP: dict[str, tuple[str, str]] = {
    "delivered":      ("GIAO_THANH_CONG", "da_nhan"),
    "received_money": ("GIAO_THANH_CONG", "da_thu_tien"),
    "packing":        ("DANG_GIAO",       "dang_dong_hang"),
    "pending":        ("DANG_GIAO",       "cho_chuyen_hang"),
    "shipped":        ("DANG_GIAO",       "da_gui_hang"),
    "returning":      ("DON_HOAN",        "dang_hoan"),
    "returned":       ("DON_HOAN",        "da_hoan"),
    "canceled":       ("HUY",             "da_huy"),
    "new":            ("DON_THO",         "moi"),
    "submitted":      ("DA_XAC_NHAN",     "da_xac_nhan"),
    "waitting":       ("CHO_HANG",        "cho_hang"),
    "ordered":        ("DA_DAT_HANG",     "da_dat_hang"),
}

# Statuses counted as "successfully delivered" (dùng để filter doanh thu)
SUCCESS_STATUSES = frozenset(["GIAO_THANH_CONG"])
SUCCESS_STATUS_NAMES = frozenset(["delivered", "received_money"])

# Statuses excluded from order count (test / draft orders)
EXCLUDE_STATUS_NAMES = frozenset(["waitting", "ordered", "canceled"])


# ─── R1: Doanh thu ──────────────────────────────────────────────────────────

def money_divisor(shop_label: str) -> int:
    """R1b (X13): shop_label → số chia đưa tiền thô của POS về đơn vị tiền thật."""
    return POS_MONEY_DIVISOR.get((shop_label or "").upper(), DEFAULT_MONEY_DIVISOR)


def calc_revenue_local(cod_raw: float, shop_label: str) -> float:
    """R1: Doanh thu (tệ địa phương) = cod / số chia CỦA SHOP ĐÓ.
    GCC lưu minor units (cod=9900 ⇒ 99,00); Đài lưu nguyên TWD (cod=950 ⇒ 950).
    Chỉ áp dụng cho đơn có status_category = GIAO_THANH_CONG và cod > 0.
    `shop_label` là BẮT BUỘC — chia 100 cho mọi shop chính là lỗi X13.
    """
    return (cod_raw or 0) / money_divisor(shop_label)


def is_success_order(status_category: str, cod_raw: float) -> bool:
    """R1: Kiểm tra đơn có tính doanh thu không."""
    return status_category in SUCCESS_STATUSES and (cod_raw or 0) > 0


# ─── R2: FX Conversion ──────────────────────────────────────────────────────

def to_vnd(amount_local: float, shop_label: str) -> float:
    """R2: Quy đổi tiền địa phương → VND theo shop_label.
    shop_label: AE / SA / KW / OM / QA / BH
    """
    rate = FX_RATES_TO_VND.get(shop_label.upper(), 0)
    if rate == 0:
        raise ValueError(f"Unknown shop_label: {shop_label}. Valid: {list(FX_RATES_TO_VND)}")
    return round(amount_local * rate, 2)


def revenue_vnd(cod_raw: float, shop_label: str) -> float:
    """R1 + R2: Doanh thu VND = (cod / số chia của shop) × FX_rate."""
    return to_vnd(calc_revenue_local(cod_raw, shop_label), shop_label)


# ─── R3: Market ─────────────────────────────────────────────────────────────

def get_market_display(shop_label: str) -> str:
    """R3: shop_label → tên hiển thị (AE → UAE, SA → Saudi...)."""
    return MARKET_NAMES.get(shop_label.upper(), shop_label)


# ─── R4: Marketer ───────────────────────────────────────────────────────────

def extract_marketer_name(marketer_raw) -> Optional[str]:
    """R4: Trích tên marketer từ cột marketer.
    Cột marketer trong BQ là chuỗi JSON: '{"name":"Hồ Sỹ Anh","id":123}'
    Trả về None nếu không parse được hoặc là Unknown.
    """
    if not marketer_raw:
        return None
    s = marketer_raw if isinstance(marketer_raw, str) else str(marketer_raw)
    s = s.strip()
    if not s or s in ("null", "None", "Unknown", "{}"):
        return None
    try:
        data = json.loads(s)
        name = data.get("name", "").strip()
        return name if name and name.lower() not in ("", "unknown") else None
    except (json.JSONDecodeError, AttributeError):
        return None


def is_valid_marketer(marketer_raw) -> bool:
    """R4: Kiểm tra đơn có marketer hợp lệ không."""
    return extract_marketer_name(marketer_raw) is not None


# ─── R5: Ads Spend ──────────────────────────────────────────────────────────

def validate_ads_spend(spend_vnd: float) -> float:
    """R5: Ads spend trong fb_ads_data.spend đã là VND.
    Không ÷100, không quy đổi thêm. Chỉ validate là số dương.
    """
    return max(0.0, float(spend_vnd or 0))


# ─── R6: Join ads↔đơn ───────────────────────────────────────────────────────

def normalize_ad_id_for_join(ad_id) -> str:
    """R6: Chuẩn hóa ad_id về STRING để join.
    fb_ads_data.ad_id là INT64, sale_order.ad_id là STRING.
    SQL: CAST(fb_ads_data.ad_id AS STRING) = sale_order.ad_id
    """
    if ad_id is None:
        return ""
    return str(int(float(ad_id))) if ad_id else ""


# ─── R7: ROAS & AOV ─────────────────────────────────────────────────────────

def calc_roas(revenue_vnd: float, spend_vnd: float) -> Optional[float]:
    """R7: ROAS = doanh thu VND ÷ ads spend VND."""
    if not spend_vnd or spend_vnd == 0:
        return None
    return round(revenue_vnd / spend_vnd, 2)


def calc_aov(revenue_vnd: float, order_count: int) -> Optional[float]:
    """R7: AOV = tổng doanh thu ÷ số đơn thành công."""
    if not order_count or order_count == 0:
        return None
    return round(revenue_vnd / order_count, 0)


# ─── R8: Timezone ───────────────────────────────────────────────────────────
# inserted_at từ Pancake là UTC. Cần convert sang timezone của từng thị trường.
# TKQC META thường dùng timezone của market khi báo cáo.
# Fix đã áp: string-slice bug ký tự 65 → 57 trong vw_orders_std.sql

MARKET_TIMEZONES: dict[str, str] = {
    "AE": "Asia/Dubai",      # UTC+4
    "SA": "Asia/Riyadh",     # UTC+3
    "KW": "Asia/Kuwait",     # UTC+3
    "OM": "Asia/Muscat",     # UTC+4
    "QA": "Asia/Qatar",      # UTC+3
    "BH": "Asia/Bahrain",    # UTC+3
    "TW": "Asia/Taipei",     # UTC+8
}


def get_market_timezone(shop_label: str) -> str:
    """R8: Trả về timezone của market theo shop_label."""
    return MARKET_TIMEZONES.get(shop_label.upper(), "Asia/Dubai")


# ─── Status helpers ──────────────────────────────────────────────────────────

def get_status_category(status_name: str) -> tuple[str, str]:
    """Mapping Poscake status_name → (category, sub_category)."""
    return STATUS_CATEGORY_MAP.get(status_name.lower(), ("UNKNOWN", "unknown"))


def should_count_as_order(status_name: str) -> bool:
    """Trả True nếu đơn được tính vào tổng đơn (không phải test/draft)."""
    return status_name.lower() not in EXCLUDE_STATUS_NAMES


# ─── SQL snippets (dùng trong query builder) ─────────────────────────────────

def sql_revenue_vnd(cod_col: str = "cod", shop_label_col: str = "shop_label") -> str:
    """SQL expression: tính doanh thu VND từ cod và shop_label.

    CASE được SINH TỪ FX_RATES_TO_VND + POS_MONEY_DIVISOR — không gõ tay lại, để bảng
    tỷ giá/số chia của Python và SQL không bao giờ lệch nhau nữa (trước đây thiếu TW
    ⇒ đơn Đài ra 0 VND; rồi chia 100 cho Đài ⇒ tiền Đài tụt 100 lần, X13).
    ELSE NULL (không phải 0): market chưa khai tỷ giá phải hiện ra là THIẾU,
    chứ không được lẫn vào doanh thu như một số 0 hợp lệ.
    """
    whens = "\n".join(
        f"        WHEN '{label}' THEN {rate:g}"
        for label, rate in FX_RATES_TO_VND.items()
        if label not in _NON_SHOP_FX_KEYS
    )
    # X13: số chia theo TỪNG shop — gõ thẳng /100 là làm tiền Đài tụt 100 lần.
    divs = "\n".join(
        f"        WHEN '{label}' THEN {div}"
        for label, div in POS_MONEY_DIVISOR.items()
    )
    return f"""({cod_col} / CASE {shop_label_col}
{divs}
        ELSE {DEFAULT_MONEY_DIVISOR}
    END) * CASE {shop_label_col}
{whens}
        ELSE NULL
    END"""


def sql_success_filter(status_category_col: str = "status_category", cod_col: str = "cod") -> str:
    """SQL WHERE clause cho đơn giao thành công."""
    return f"{status_category_col} = 'GIAO_THANH_CONG' AND {cod_col} > 0"


def sql_marketer_name(marketer_col: str = "marketer") -> str:
    """SQL expression: trích tên marketer từ JSON string."""
    return f"JSON_EXTRACT_SCALAR({marketer_col}, '$.name')"


def sql_ads_join_condition(ads_ad_id: str = "a.ad_id", order_ad_id: str = "o.ad_id") -> str:
    """SQL JOIN condition: ads(INT64) ↔ orders(STRING)."""
    return f"CAST({ads_ad_id} AS STRING) = {order_ad_id}"
