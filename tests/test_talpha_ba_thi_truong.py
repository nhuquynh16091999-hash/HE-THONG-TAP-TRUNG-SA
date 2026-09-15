"""
Ba thị trường — Đài Loan · Singapore · UAE (Sỹ Anh chốt 15/09/2026).

Chạy: python3 -m pytest tests/test_talpha_ba_thi_truong.py -q

Canh luật gán nước cho chi tiêu quảng cáo: ô đầu tên campaign là nước; tên cũ không ghi
nước vẫn tính Đài nhưng phải nhận ra được để cảnh báo.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "ops" / "talpha_reports"))

from talpha_rules import (  # noqa: E402
    campaign_market, RATE, MONEY_DIV, DANG_BAN, CURRENCY_SYMBOL, NO_TEST_MARKETS, is_test,
)


class TestGanNuocTheoTenCampaign:
    def test_o_dau_la_nuoc(self):
        assert campaign_market("TW/LOC/PHI/042-BLACK/TaiwanPrimeLeather/2808") == ("Taiwan", "o_dau")
        assert campaign_market("SG/LOC/PHI/042-BLACK/LuxeGold/1509") == ("Singapore", "o_dau")
        assert campaign_market("AE/THAI/PHI/040-VONGVANG1/LumoraJewelry/1509") == ("UAE", "o_dau")

    def test_cac_cach_viet_nuoc(self):
        for ten, nuoc in (("SINGAPORE/LOC/x", "Singapore"), ("sing/LOC/x", "Singapore"),
                          ("UAE/LOC/x", "UAE"), ("Dubai/LOC/x", "UAE"), ("TAIWAN/LOC/x", "Taiwan")):
            assert campaign_market(ten)[0] == nuoc, ten

    def test_ten_cu_khong_ghi_nuoc_tinh_dai_va_bi_danh_dau(self):
        assert campaign_market("Lộc/Philippine/050 - SET8/Catholic Essentials HK/3-9") == ("Taiwan", "mac_dinh")

    def test_nuoc_o_giua_ten_kieu_cu(self):
        assert campaign_market("Tặng/TW/LOC/042/Page/2808") == ("Taiwan", "o_khac")

    def test_ma_nuoc_phai_dung_ca_o_khong_bat_mau_chu(self):
        # "Master Jewelry Gold - TW - 02" là tên trang có chữ TW, không phải ô nước.
        assert campaign_market("Thainx/INDO/SET KC/Master Jewelry Gold - TW - 02/09")[1] == "mac_dinh"


class TestNuocSapChay:
    def test_chua_co_ty_gia_thi_doanh_thu_bang_khong(self):
        assert RATE["Singapore"] == 0 and RATE["UAE"] == 0
        assert MONEY_DIV["Singapore"] == 1 and MONEY_DIV["UAE"] == 1

    def test_chi_dai_dang_ban(self):
        assert DANG_BAN == ["Taiwan"]

    def test_ky_hieu_tien(self):
        assert CURRENCY_SYMBOL == {"Taiwan": "NT$", "Singapore": "S$", "UAE": "AED"}

    def test_ca_ba_nuoc_mien_luat_test(self):
        assert NO_TEST_MARKETS == {"Taiwan", "Singapore", "UAE"}
        assert is_test("SG/LOC/PHI/TEST/Page/1509", "Singapore") is False
