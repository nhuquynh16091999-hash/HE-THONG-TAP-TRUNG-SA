"""
Unit tests cho 8 TALPHA business rules.

Chạy:
  pytest tests/test_talpha_business_rules.py -v

Không cần kết nối BigQuery hay external APIs — tests chạy offline hoàn toàn.
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from sync.core.business_rules import (
    # R1
    calc_revenue_local, is_success_order,
    # R2
    to_vnd, revenue_vnd, FX_RATES_TO_VND,
    # R3
    get_market_display, MARKET_NAMES,
    # R4
    extract_marketer_name, is_valid_marketer,
    # R5
    validate_ads_spend,
    # R6
    normalize_ad_id_for_join,
    # R7
    calc_roas, calc_aov,
    # R8
    get_market_timezone,
    # Helpers
    get_status_category, should_count_as_order,
    sql_revenue_vnd, sql_success_filter, sql_marketer_name, sql_ads_join_condition,
    SUCCESS_STATUSES, EXCLUDE_STATUS_NAMES,
)


# ─── R1: Doanh thu ──────────────────────────────────────────────────────────

class TestR1Revenue:
    def test_cod_divided_by_100(self):
        """Shop GCC lưu cod × 100. Ví dụ: cod=9900 → 99.00 AED"""
        assert calc_revenue_local(9900, "AE") == 99.0

    def test_cod_zero(self):
        assert calc_revenue_local(0, "AE") == 0.0

    def test_cod_none(self):
        assert calc_revenue_local(None, "AE") == 0.0

    def test_cod_typical_uae(self):
        """99 AED → cod=9900"""
        assert calc_revenue_local(9900, "AE") == 99.0

    def test_cod_combo_2(self):
        """149 AED → cod=14900"""
        assert calc_revenue_local(14900, "AE") == 149.0

    def test_taiwan_cod_is_whole_twd_not_minor_units(self):
        """X13 — shop Đài lưu NGUYÊN TWD, KHÔNG chia 100.

        Ground truth POS API 20/08: đơn TW id=336 có cod=950 cho 1 Birthstone Set
        + 1 BOX ⇒ 950 TWD (~760k VND), không phải 9,50 TWD (~7,6k VND).
        Chia 100 như GCC là lỗi X13 — doanh thu Đài tụt đúng 100 lần.
        """
        assert calc_revenue_local(950, "TW") == 950.0
        assert revenue_vnd(950, "TW") == 760000.0

    def test_money_divisor_unknown_shop_defaults_to_minor_units(self):
        """Shop mới chưa khai → giữ mặc định 100 (hành vi cũ), is_fx_known lo phần cảnh báo."""
        assert calc_revenue_local(9900, "ZZ") == 99.0

    def test_is_success_giao_thanh_cong_with_cod(self):
        assert is_success_order("GIAO_THANH_CONG", 9900) is True

    def test_is_not_success_when_cod_zero(self):
        """Đơn GIAO_THANH_CONG nhưng cod=0 không tính DT"""
        assert is_success_order("GIAO_THANH_CONG", 0) is False

    def test_is_not_success_dang_giao(self):
        assert is_success_order("DANG_GIAO", 9900) is False

    def test_is_not_success_huy(self):
        assert is_success_order("HUY", 9900) is False

    def test_is_not_success_don_hoan(self):
        assert is_success_order("DON_HOAN", 9900) is False


# ─── R2: FX Rates ───────────────────────────────────────────────────────────

class TestR2FX:
    def test_all_markets_have_rate(self):
        for market in ["AE", "SA", "KW", "OM", "QA", "BH", "TW"]:
            assert market in FX_RATES_TO_VND, f"Missing rate for {market}"
            assert FX_RATES_TO_VND[market] > 0

    def test_aed_rate(self):
        assert to_vnd(1, "AE") == 7010.0

    def test_sar_rate(self):
        assert to_vnd(1, "SA") == 6850.0

    def test_kwd_rate(self):
        assert to_vnd(1, "KW") == 83000.0

    def test_omr_rate(self):
        assert to_vnd(1, "OM") == 66700.0

    def test_qar_rate(self):
        assert to_vnd(1, "QA") == 7050.0

    def test_bhd_rate(self):
        assert to_vnd(1, "BH") == 68000.0

    def test_twd_rate(self):
        """Taiwan — market mở sau, từng thiếu trong bảng FX ⇒ to_vnd raise ValueError"""
        assert to_vnd(1, "TW") == 800.0

    def test_usd_rate(self):
        assert to_vnd(1, "USD") == 25700.0

    def test_unknown_market_raises(self):
        with pytest.raises(ValueError, match="Unknown shop_label"):
            to_vnd(100, "XX")

    def test_lowercase_market_works(self):
        """shop_label case-insensitive"""
        assert to_vnd(1, "ae") == 7010.0

    def test_revenue_vnd_uae(self):
        """cod=9900 ÷100 × 7010 = 99 × 7010 = 693,990 VND"""
        result = revenue_vnd(9900, "AE")
        assert result == 99.0 * 7010

    def test_revenue_vnd_kw(self):
        """cod=900 ÷100 = 9.0 KWD × 83000 = 747,000 VND"""
        result = revenue_vnd(900, "KW")
        assert result == 9.0 * 83000


# ─── R3: Market ─────────────────────────────────────────────────────────────

class TestR3Market:
    def test_all_markets_have_display_name(self):
        for code in ["AE", "SA", "KW", "OM", "QA", "BH", "TW"]:
            assert code in MARKET_NAMES

    def test_ae_displays_uae(self):
        assert get_market_display("AE") == "UAE"

    def test_sa_displays_saudi(self):
        assert get_market_display("SA") == "Saudi"

    def test_kw_displays_kuwait(self):
        assert get_market_display("KW") == "Kuwait"

    def test_unknown_returns_code(self):
        assert get_market_display("XX") == "XX"


# ─── R4: Marketer ───────────────────────────────────────────────────────────

class TestR4Marketer:
    def test_extract_from_json_string(self):
        raw = '{"name":"Hồ Sỹ Anh","id":123}'
        assert extract_marketer_name(raw) == "Hồ Sỹ Anh"

    def test_extract_all_7_marketers(self):
        marketers = [
            ("SSA", "Hồ Sỹ Anh"),
            ("SSL", "Hồ Sỹ Lộc"),
            ("CTT", "Chu Thị Thuý"),
            ("HTTN", "Hoàng Thị Thuỳ Nhung"),
            ("TNT", "Trần Ngọc Thế"),
            ("PHTM", "Phạm Hà Thục Mai"),
            ("LTB", "Lê Thục Bình"),
        ]
        for code, name in marketers:
            raw = f'{{"name":"{name}","id":"{code}"}}'
            assert extract_marketer_name(raw) == name

    def test_none_returns_none(self):
        assert extract_marketer_name(None) is None

    def test_empty_string_returns_none(self):
        assert extract_marketer_name("") is None

    def test_null_string_returns_none(self):
        assert extract_marketer_name("null") is None

    def test_unknown_returns_none(self):
        assert extract_marketer_name('{"name":"Unknown"}') is None

    def test_invalid_json_returns_none(self):
        assert extract_marketer_name("not-json") is None

    def test_is_valid_marketer_true(self):
        assert is_valid_marketer('{"name":"Hồ Sỹ Anh"}') is True

    def test_is_valid_marketer_false_for_null(self):
        assert is_valid_marketer(None) is False


# ─── R5: Ads Spend ──────────────────────────────────────────────────────────

class TestR5AdsSpend:
    def test_spend_already_vnd_no_conversion(self):
        """spend trong fb_ads_data đã là VND — không cần ÷100 hay quy đổi thêm"""
        spend = 1_500_000.0  # 1.5 triệu VND
        assert validate_ads_spend(spend) == 1_500_000.0

    def test_spend_none_returns_zero(self):
        assert validate_ads_spend(None) == 0.0

    def test_spend_negative_returns_zero(self):
        assert validate_ads_spend(-100) == 0.0


# ─── R6: ad_id Join ─────────────────────────────────────────────────────────

class TestR6AdIdJoin:
    def test_int64_to_string(self):
        """fb_ads_data.ad_id INT64 → STRING để join với sale_order.ad_id STRING"""
        assert normalize_ad_id_for_join(123456789) == "123456789"

    def test_float_to_string(self):
        """ad_id có thể về dạng float từ JSON"""
        assert normalize_ad_id_for_join(123456789.0) == "123456789"

    def test_string_passthrough(self):
        assert normalize_ad_id_for_join("987654321") == "987654321"

    def test_none_returns_empty(self):
        assert normalize_ad_id_for_join(None) == ""

    def test_zero_returns_empty(self):
        assert normalize_ad_id_for_join(0) == ""


# ─── R7: ROAS & AOV ─────────────────────────────────────────────────────────

class TestR7RoasAov:
    def test_roas_calculation(self):
        """ROAS = DT ÷ spend (cùng đơn vị VND)"""
        # 100 triệu DT / 25 triệu spend = ROAS 4.0
        assert calc_roas(100_000_000, 25_000_000) == 4.0

    def test_roas_zero_spend_returns_none(self):
        assert calc_roas(100_000_000, 0) is None

    def test_roas_target_4(self):
        """ROAS target của TALPHA là 4.0"""
        roas = calc_roas(40_000_000, 10_000_000)
        assert roas == 4.0

    def test_aov_calculation(self):
        """AOV = DT ÷ số đơn (đơn VND)"""
        # 10 đơn, tổng 6,930,900 VND = AOV 693,090 VND (~99 AED)
        assert calc_aov(6_930_900, 10) == 693_090.0

    def test_aov_zero_orders_returns_none(self):
        assert calc_aov(1_000_000, 0) is None


# ─── R8: Timezone ───────────────────────────────────────────────────────────

class TestR8Timezone:
    def test_uae_timezone(self):
        assert get_market_timezone("AE") == "Asia/Dubai"

    def test_saudi_timezone(self):
        assert get_market_timezone("SA") == "Asia/Riyadh"

    def test_kuwait_timezone(self):
        assert get_market_timezone("KW") == "Asia/Kuwait"

    def test_oman_timezone(self):
        assert get_market_timezone("OM") == "Asia/Muscat"

    def test_unknown_defaults_to_dubai(self):
        assert get_market_timezone("XX") == "Asia/Dubai"

    def test_taiwan_timezone(self):
        assert get_market_timezone("TW") == "Asia/Taipei"

    def test_all_markets_have_timezone(self):
        for market in ["AE", "SA", "KW", "OM", "QA", "BH", "TW"]:
            tz = get_market_timezone(market)
            assert tz.startswith("Asia/"), f"{market} timezone invalid: {tz}"


# ─── Status mapping ──────────────────────────────────────────────────────────

class TestStatusMapping:
    def test_delivered_is_success(self):
        cat, sub = get_status_category("delivered")
        assert cat == "GIAO_THANH_CONG"
        assert sub == "da_nhan"

    def test_received_money_is_success(self):
        cat, sub = get_status_category("received_money")
        assert cat == "GIAO_THANH_CONG"

    def test_returning_is_hoan(self):
        cat, _ = get_status_category("returning")
        assert cat == "DON_HOAN"

    def test_canceled_is_huy(self):
        cat, _ = get_status_category("canceled")
        assert cat == "HUY"

    def test_shipped_is_dang_giao(self):
        cat, _ = get_status_category("shipped")
        assert cat == "DANG_GIAO"

    def test_unknown_status_returns_unknown(self):
        cat, sub = get_status_category("some_weird_status")
        assert cat == "UNKNOWN"

    def test_waitting_excluded_from_count(self):
        assert should_count_as_order("waitting") is False

    def test_ordered_excluded_from_count(self):
        assert should_count_as_order("ordered") is False

    def test_delivered_counted(self):
        assert should_count_as_order("delivered") is True


# ─── SQL snippets ────────────────────────────────────────────────────────────

class TestSqlSnippets:
    def test_revenue_sql_contains_fx_rates(self):
        sql = sql_revenue_vnd()
        assert "7010" in sql   # AED
        assert "6850" in sql   # SAR
        assert "83000" in sql  # KWD
        assert "800" in sql    # TWD (Taiwan)

    def test_revenue_sql_covers_every_shop_label(self):
        """Chống lệch: CASE trong SQL phải phủ ĐÚNG các shop_label của FX_RATES_TO_VND.
        Lỗi cũ: bảng Python có TW=800 nhưng CASE gõ tay thiếu ⇒ đơn Đài ra 0 VND.
        """
        sql = sql_revenue_vnd()
        for label in FX_RATES_TO_VND:
            if label == "USD":       # tiền ads, không phải shop_label của đơn
                assert f"WHEN '{label}'" not in sql
                continue
            assert f"WHEN '{label}'" in sql, f"CASE thiếu shop_label {label}"

    def test_revenue_sql_divides_per_shop_not_flat_100(self):
        """X13 — số chia phải theo TỪNG shop. `/ 100.0` cứng làm tiền Đài tụt 100 lần."""
        sql = sql_revenue_vnd()
        assert "/ 100.0" not in sql
        assert "WHEN 'TW' THEN 1" in sql
        assert "WHEN 'SA' THEN 100" in sql

    def test_revenue_sql_unknown_market_is_null_not_zero(self):
        """Market chưa khai tỷ giá phải ra NULL (thấy được là THIẾU), không phải 0."""
        assert "ELSE NULL" in sql_revenue_vnd()

    def test_success_filter_contains_giao_thanh_cong(self):
        sql = sql_success_filter()
        assert "GIAO_THANH_CONG" in sql
        assert "cod" in sql.lower()

    def test_marketer_sql_uses_json_extract(self):
        sql = sql_marketer_name()
        assert "JSON_EXTRACT_SCALAR" in sql
        assert "$.name" in sql

    def test_ads_join_uses_cast(self):
        sql = sql_ads_join_condition()
        assert "CAST" in sql
        assert "AS STRING" in sql
