"""
Rule nghiệp vụ TALPHA — hệ MỘT thị trường Đài Loan (từ 05/09/2026).

Chạy: python3 -m pytest tests/test_talpha_business_rules.py -q

Bài test này canh đúng những chỗ đã từng làm sai số thật:
  • X13 — shop Đài lưu NGUYÊN TWD, chia 100 là tiền tụt đúng 100 lần
  • Doanh thu chỉ tính đơn GIAO THÀNH CÔNG và cod > 0
  • Spend quảng cáo ĐÃ là VND — quy đổi thêm lần nữa là thổi chi phí lên
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sync.core.business_rules import (  # noqa: E402
    FX_RATES_TO_VND, POS_MONEY_DIVISOR, MARKET_NAMES,
    money_divisor, calc_revenue_local, is_success_order, to_vnd, revenue_vnd,
    get_market_display, get_market_timezone, extract_marketer_name,
    is_valid_marketer, validate_ads_spend, normalize_ad_id_for_join,
    calc_roas, calc_aov,
)


class TestChiCoMotThiTruong:
    def test_chi_khai_dai_loan(self):
        assert set(MARKET_NAMES) == {"TW"}
        assert set(POS_MONEY_DIVISOR) == {"TW"}

    def test_fx_chi_con_twd_va_usd(self):
        assert set(FX_RATES_TO_VND) == {"TW", "USD"}


class TestX13SoChia:
    """Shop Đài lưu nguyên TWD — số chia phải là 1, không phải 100."""

    def test_so_chia_dai_la_mot(self):
        assert money_divisor("TW") == 1

    def test_cod_950_la_950_twd(self):
        # Đơn thật id=336: 1 Birthstone Set + 1 BOX, cod=950 ⇒ 950 TWD (~760k VND).
        assert calc_revenue_local(950, "TW") == 950.0

    def test_cod_le_khong_bi_chia(self):
        for cod in (1390, 999, 1499, 6999):
            assert calc_revenue_local(cod, "TW") == float(cod)

    def test_cod_rong(self):
        assert calc_revenue_local(0, "TW") == 0.0
        assert calc_revenue_local(None, "TW") == 0.0


class TestQuyDoiVND:
    def test_ty_gia_twd(self):
        assert to_vnd(1, "TW") == 800.0

    def test_doanh_thu_don_that(self):
        # 950 TWD × 800 = 760.000 VND
        assert revenue_vnd(950, "TW") == 760000.0


class TestDonThanhCong:
    def test_giao_thanh_cong_co_tien(self):
        assert is_success_order("GIAO_THANH_CONG", 950) is True

    def test_giao_thanh_cong_khong_tien_khong_tinh(self):
        assert is_success_order("GIAO_THANH_CONG", 0) is False

    def test_don_hoan_khong_tinh(self):
        assert is_success_order("DON_HOAN", 950) is False

    def test_don_huy_khong_tinh(self):
        assert is_success_order("HUY", 950) is False


class TestThiTruong:
    def test_ten_hien_thi(self):
        assert get_market_display("TW") == "Taiwan"

    def test_mui_gio_dai_bac(self):
        assert get_market_timezone("TW") == "Asia/Taipei"

    def test_shop_la_khong_khai_van_ve_dai_bac(self):
        # Chỉ còn một thị trường nên mặc định phải là Đài Bắc, không phải Dubai.
        assert get_market_timezone("XX") == "Asia/Taipei"


class TestMarketer:
    def test_tach_ten_tu_json(self):
        assert extract_marketer_name('{"name": "Hồ Sỹ Lộc"}') == "Hồ Sỹ Lộc"

    def test_ten_dang_chuoi_thuong(self):
        assert extract_marketer_name("Chu Thuý") == "Chu Thuý"

    def test_rong_thi_khong_hop_le(self):
        assert is_valid_marketer("") is False
        assert is_valid_marketer(None) is False


class TestChiPhiQuangCao:
    def test_spend_da_la_vnd(self):
        # Rule #3: spend từ Meta đã là VND — hàm không được nhân thêm tỷ giá.
        assert validate_ads_spend(1_000_000) == 1_000_000

    def test_ad_id_ve_chuoi_de_join(self):
        assert normalize_ad_id_for_join(123456789) == "123456789"
        assert normalize_ad_id_for_join("123456789") == "123456789"


class TestChiSo:
    def test_roas(self):
        assert calc_roas(3_000_000, 1_000_000) == 3.0

    def test_roas_chia_khong(self):
        assert calc_roas(3_000_000, 0) is None

    def test_aov(self):
        assert calc_aov(7_600_000, 10) == 760_000.0

    def test_aov_khong_co_don(self):
        assert calc_aov(7_600_000, 0) is None
