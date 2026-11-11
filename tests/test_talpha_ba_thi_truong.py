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
    norm_nv, norm_pos_nv, nguoi_tinh_so, NGUOI_CAM,
    campaign_market, RATE, MONEY_DIV, DANG_BAN, CURRENCY_SYMBOL, NO_TEST_MARKETS, is_test,
    cost_price_vnd, COST_RATE_RMB_VND, RULES,
)


class TestGanNuocTheoTenCampaign:
    def test_o_dau_la_nuoc(self):
        assert campaign_market("TW/LOC/PHI/042-BLACK/TaiwanPrimeLeather/2808") == ("Taiwan", "o_dau")
        assert campaign_market("SG/LOC/PHI/042-BLACK/LuxeGold/1509") == ("Singapore", "o_dau")
        assert campaign_market("AE/THAI/PHI/040-VONGVANG1/LumoraJewelry/1509") == ("UAE", "o_dau")

    def test_nhat_ban(self):
        # 08/10/2026: camp Nhật đầu tiên — trước khi khai JP, cả hai bị tính về Đài.
        assert campaign_market("JP/THANG/PHI/002-ATTL/Lucky Charm JP/08-10") == ("Japan", "o_dau")
        assert campaign_market("JP/THƯƠNG/PHI/011/Lucky Silver JP/08-10") == ("Japan", "o_dau")
        # Tên trang có chữ Japan/JP KHÔNG phải ô nước.
        assert campaign_market("TW/THƯƠNG/PHI/042/Japan Prime Leather/6-10")[0] == "Taiwan"
        # 09/10/2026 nối shop POS "JAPAN" 1022115860 — đang bán, POS lưu nguyên yên.
        assert "Japan" in DANG_BAN and MONEY_DIV["Japan"] == 1 and RATE["Japan"] == 160

    def test_camp_va_don_cua_sy_anh_o_nhat(self):
        # 10/10/2026: camp JAPAN/ANH/… (3,8tr/ngày) bị Sheet bỏ hẳn, 17 đơn tag "Hồ Sỹ Aanh" vào (không gán).
        assert campaign_market("JAPAN/ANH/PHI/Birstone/Veloura Collection Gold/10-10")[0] == "Japan"
        assert norm_nv("ANH") == "SAnh"
        assert norm_pos_nv("Hồ Sỹ Aanh") == "SAnh"
        assert norm_pos_nv("Anh Tuấn") is None and norm_pos_nv("Ánh") is None   # không vơ tên khác có chữ Anh

    def test_lan_nuoc_tinh_cho_nguoi_cam_nuoc(self):
        # Sỹ Anh chốt 10/10/2026: camp cũ chưa đổi tên chạy lấn nước của team khác → người cầm nước đó.
        # 03/11/2026: Sỹ Anh cầm Đài từ tháng 10 (trước là Thương).
        assert NGUOI_CAM == {"Taiwan": "SAnh", "Singapore": "Thai", "UAE": "Loc", "Japan": "SAnh"}
        assert nguoi_tinh_so("Loc", "Taiwan") == "SAnh" and nguoi_tinh_so("Loc", "Singapore") == "Thai"
        assert nguoi_tinh_so("Thai", "Taiwan") == "SAnh" and nguoi_tinh_so("Thuong", "Singapore") == "Thai"
        # Đúng nước của team mình thì giữ nguyên — Đông Á gồm Đài + Nhật.
        assert nguoi_tinh_so("Loc", "UAE") == "Loc" and nguoi_tinh_so("Thang", "Japan") == "Thang"
        assert nguoi_tinh_so("Quynh", "Taiwan") == "Quynh" and nguoi_tinh_so("SAnh", "Japan") == "SAnh"
        assert nguoi_tinh_so("(không gán)", "Taiwan") == "(không gán)"

    def test_nguoi_ngung_chay_tinh_cho_nguoi_cam_tu_ngay_ngung(self):
        # Sỹ Anh chốt 03/11/2026: Thương không chạy từ tháng 10 — tag POS "Thương Thương" (Thương tạo
        # đơn với vai sale) và camp cũ TW/THƯƠNG… từ 01/10 về người cầm nước; tháng 9 giữ tên Thương.
        assert nguoi_tinh_so("Thuong", "Taiwan", "2026-09-30") == "Thuong"
        assert nguoi_tinh_so("Thuong", "Japan", "2026-09-30") == "Thuong"
        assert nguoi_tinh_so("Thuong", "Singapore", "2026-09-30") == "Thai"   # lấn nước vẫn như cũ
        assert nguoi_tinh_so("Thuong", "Taiwan", "2026-10-01") == "SAnh"
        assert nguoi_tinh_so("Thuong", "Japan", "2026-10-08") == "SAnh"
        assert nguoi_tinh_so("Thuong", "UAE", "2026-11-03") == "Loc"
        assert nguoi_tinh_so("Thuong", "Taiwan") == "SAnh"                   # không ngày = số hiện tại
        assert nguoi_tinh_so("Quynh", "Taiwan", "2026-11-03") == "Quynh"

    def test_cac_cach_viet_nuoc(self):
        for ten, nuoc in (("SINGAPORE/LOC/x", "Singapore"), ("sing/LOC/x", "Singapore"),
                          ("SGP/LOC/PHI/075 - SETTS01/Lucky Silver Philippines/13-9", "Singapore"),
                          ("UAE/LOC/x", "UAE"), ("Dubai/LOC/x", "UAE"), ("TAIWAN/LOC/x", "Taiwan")):
            assert campaign_market(ten)[0] == nuoc, ten

    def test_ten_cu_khong_ghi_nuoc_tinh_dai_va_bi_danh_dau(self):
        assert campaign_market("Lộc/Philippine/050 - SET8/Catholic Essentials HK/3-9") == ("Taiwan", "mac_dinh")

    def test_nuoc_o_giua_ten_kieu_cu(self):
        assert campaign_market("Tặng/TW/LOC/042/Page/2808") == ("Taiwan", "o_khac")

    def test_ma_nuoc_phai_dung_ca_o_khong_bat_mau_chu(self):
        # "Master Jewelry Gold - TW - 02" là tên trang có chữ TW, không phải ô nước.
        assert campaign_market("Thainx/INDO/SET KC/Master Jewelry Gold - TW - 02/09")[1] == "mac_dinh"


class TestTrangThaiNuoc:
    def test_singapore_da_noi(self):
        assert RATE["Singapore"] == 20000 and MONEY_DIV["Singapore"] == 100

    def test_uae_da_co_ty_gia(self):
        # Chốt 15/09/2026: 1 AED = 7.000đ. Số chia 100 chưa đo — phải khai cùng lúc với tỷ
        # giá: để trống thì ở đây ra 1 trong khi view BigQuery chia 100.
        assert RATE["UAE"] == 7000 and MONEY_DIV["UAE"] == 100

    def test_ca_ba_nuoc_dang_ban(self):
        # Nhật nối shop 09/10/2026.
        # Việt Nam nối shop 11/11/2026 (hạt giống, VND).
        assert DANG_BAN == ["Taiwan", "Singapore", "UAE", "Japan", "Vietnam"]

    def test_ky_hieu_tien(self):
        assert CURRENCY_SYMBOL == {"Taiwan": "NT$", "Singapore": "S$", "UAE": "AED", "Japan": "¥", "Vietnam": "đ"}

    def test_ca_ba_nuoc_mien_luat_test(self):
        assert NO_TEST_MARKETS == {"Taiwan", "Singapore", "UAE", "Japan", "Vietnam"}
        assert is_test("SG/LOC/PHI/TEST/Page/1509", "Singapore") is False


class TestGiaVon:
    def test_quy_tu_te_theo_ty_gia_cau_hinh(self):
        assert COST_RATE_RMB_VND == 3860
        assert cost_price_vnd("002") == round(RULES["products"]["002"]["cost_price_rmb"] * 3860)

    def test_ma_chua_khai_thi_none_khong_phai_0(self):
        assert cost_price_vnd("khong-co-ma-nay") is None


class TestVietNam:
    """Mở Việt Nam 11/11/2026: "VN" vừa là mã nước vừa là TỆP KHÁCH người Việt ở Đài —
    chỉ ô ĐẦU mới là nước."""

    def test_vn_o_dau_la_viet_nam(self):
        assert campaign_market("VN/THÁI/VN/VẠN THỌ / Hạt Giống Nông Nghiệp F1/10-11") == ("Vietnam", "o_dau")
        assert campaign_market("VN/THÁI/HOA VẠN THỌ/Kho Hạt Giống Việt/04-11") == ("Vietnam", "o_dau")

    def test_vn_o_khac_van_la_tep_khach(self):
        # Camp Đài nhắm người Việt ở Đài: vẫn là Đài.
        assert campaign_market("TW/THUONG/VN/TEST/Trang Sức Vàng Thái/14-09")[0] == "Taiwan"
        # Tên kiểu cũ không ghi nước: VN ở ô 2 KHÔNG được biến thành Việt Nam.
        assert campaign_market("THUONG/VN/042/Trang/1-9") == ("Taiwan", "mac_dinh")
