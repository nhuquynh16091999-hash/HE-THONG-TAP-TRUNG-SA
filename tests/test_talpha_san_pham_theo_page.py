"""
Tab sản phẩm trong file Sheet: đọc sản phẩm từ tên campaign, gán đơn về sản phẩm THEO PAGE.

Chạy: python3 -m pytest tests/test_talpha_san_pham_theo_page.py -q

16/09/2026 Sỹ Anh mở tab "040 - VONGVANG1" của Lộc: có tiền ads, 0 đơn — "phải tính theo
page chứ, theo luồng nghiệp vụ cũ". Soi ra cả tháng 9 mọi đơn rơi vào tab "(khác)" (luồng cũ
nối đơn qua SỐ page trong tên camp, tên bây giờ chỉ ghi TÊN trang), kèm hai lỗi đọc ô làm
mọc tab "PHI", "INDO" (tệp khách) và "4-9 TEST", "7-9" (ngày). Tên campaign dưới đây là tên
THẬT đang chạy tháng 9/2026.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "ops" / "talpha_reports"))

from talpha_rules import camp_san_pham, hoc_page_san_pham, san_pham_cua_don  # noqa: E402


class TestDocSanPhamTuTenCampaign:
    def test_ten_chuan_co_o_nuoc_khong_lay_nham_tep_khach(self):
        # Lỗi cũ: ô ngay sau marketer (tệp khách) bị lấy làm sản phẩm → tab "PHI" 4,98tr ads.
        assert camp_san_pham("TW/LOC/PHI/072 - DENTAL/DOC Alipion-Tooth ARMOR TW/8-9")[:2] == \
            ("072 - DENTAL", "DOC Alipion-Tooth ARMOR TW")
        assert camp_san_pham("TW/LOC/INDO/042 - BLACK/𝑰𝒕𝒂𝒍𝒚 𝑷𝒓𝒊𝒎𝒆 𝑳𝒆𝒂𝒕𝒉𝒆𝒓/5-9")[0] == "042 - BLACK"
        assert camp_san_pham("TW/THÁI/VIỆT/GIÀY g_c05 /EZMAN Sneaker - TW/ 06/09")[0] == "GIÀY g_c05"
        assert camp_san_pham("TW/THẮNG /TỆP PHI/VÒNG MAY MẮN/𝐁𝐢𝐲𝐚𝐲𝐚 𝐓𝐖/1258963223972395/4-9 TEST")[0] == "VÒNG MAY MẮN"
        assert camp_san_pham("SGP/LOC/PHI/075 - SETTS01/Lucky Silver Philippines/13-9")[0] == "075 - SETTS01"

    def test_ten_cu_khong_o_nuoc_van_dung(self):
        assert camp_san_pham("Lộc/Philippine/040 - VONGVANG1/𝑻𝒂𝒊𝒘𝒂𝒏 𝑮𝒐𝒍𝒅𝒆𝒏 𝑩𝒓𝒂𝒄𝒆𝒍𝒆𝒕/28-8")[:2] == \
            ("040 - VONGVANG1", "𝑻𝒂𝒊𝒘𝒂𝒏 𝑮𝒐𝒍𝒅𝒆𝒏 𝑩𝒓𝒂𝒄𝒆𝒍𝒆𝒕")
        assert camp_san_pham("Thainx/INDO/SET KC/Master Jewelry Gold - TW - 02/09")[0] == "SET KC"
        assert camp_san_pham("THƯƠNG/VN/DAY CHUYEN RONG VANG/Trang Sức Vàng Thái/1226125240593692/4-9 TEST")[0] == \
            "DAY CHUYEN RONG VANG"

    def test_so_page_dung_sau_ten_trang_khong_bien_ngay_thanh_san_pham(self):
        # Lỗi cũ: lấy ô SAU con số làm sản phẩm → tab "4-9 TEST" (Thắng), "7-9" (Thương).
        sp, trang, page_id = camp_san_pham("TW/THẮNG /TỆP PHI/VÒNG MAY MẮN/𝐁𝐢𝐲𝐚𝐲𝐚 𝐓𝐖/1258963223972395/4-9 TEST")
        assert (sp, page_id) == ("VÒNG MAY MẮN", "1258963223972395")
        sp, _, page_id = camp_san_pham("TW/THUONG/PHI/TEST/𝙻𝚞𝚌𝚔𝚢 𝙲𝚑𝚊𝚛𝚖 𝙿𝙷/1306085275928527/7-9")
        assert (sp, page_id) == ("TEST · 𝙻𝚞𝚌𝚔𝚢 𝙲𝚑𝚊𝚛𝚖 𝙿𝙷", "1306085275928527")

    def test_kieu_gcc_so_page_chiem_o_san_pham_thi_san_pham_la_ten_trang(self):
        # Luồng cũ: tên có số page đứng TRƯỚC tên trang → sản phẩm chính là trang.
        assert camp_san_pham("TW/Loc/1303370732848505/Taiwan Prime Leather/2808")[::2] == \
            ("Taiwan Prime Leather", "1303370732848505")

    def test_ngay_bon_so_khong_bi_nham_la_so_page(self):
        assert camp_san_pham("TW/LOC/PHI/042-BLACK/TaiwanPrimeLeather/2808")[2] is None

    def test_camp_test_tach_theo_trang(self):
        assert camp_san_pham("TW/LOC/PHI/TEST/Saqrr gold Jewelry Taiwan/14-9")[0] == "TEST · Saqrr gold Jewelry Taiwan"

    def test_khong_nhan_ra_marketer(self):
        assert camp_san_pham("Ai do/khong ro/xyz") == (None, None, None)


class TestGanDonVeSanPhamTheoPage:
    # page A chạy một sản phẩm; page B chạy hai; page C chưa nối được camp nào
    PAGE_SP = hoc_page_san_pham([
        ("A", "040 - VONGVANG1", 3),
        ("B", "042 - BLACK", 5), ("B", "Ví", 2),
        (None, "036 - BROWN", 9),          # đơn không có page: không dạy được gì
        ("A", None, 4),                     # đơn không nối được quảng cáo: không dạy được gì
    ])

    def test_hoc_bo_qua_dong_thieu_page_hoac_san_pham(self):
        assert self.PAGE_SP == {"A": {"040 - VONGVANG1": 3}, "B": {"042 - BLACK": 5, "Ví": 2}}

    def test_page_mot_san_pham_thi_don_khong_ghi_quang_cao_van_ve_dung_tab(self):
        assert san_pham_cua_don("A", None, self.PAGE_SP) == "040 - VONGVANG1"

    def test_page_theo_page_thang_quang_cao_ghi_lech(self):
        # Page chỉ chạy MỘT sản phẩm thì tính theo page, kể cả ô ad_id POS ghi lạc sang camp khác.
        assert san_pham_cua_don("A", "042 - BLACK", self.PAGE_SP) == "040 - VONGVANG1"

    def test_page_nhieu_san_pham_tach_theo_quang_cao_cua_don(self):
        assert san_pham_cua_don("B", "Ví", self.PAGE_SP) == "Ví"
        assert san_pham_cua_don("B", "042 - BLACK", self.PAGE_SP) == "042 - BLACK"

    def test_page_nhieu_san_pham_don_khong_quang_cao_ve_san_pham_nhieu_don_nhat(self):
        assert san_pham_cua_don("B", None, self.PAGE_SP) == "042 - BLACK"

    def test_hoa_so_don_thi_chon_theo_ten_cho_co_dinh(self):
        ps = hoc_page_san_pham([("D", "Y", 2), ("D", "X", 2)])
        assert san_pham_cua_don("D", None, ps) == "X"

    def test_page_chua_noi_duoc_thi_dung_quang_cao_roi_moi_toi_khac(self):
        assert san_pham_cua_don("C", "036 - BROWN", self.PAGE_SP) == "036 - BROWN"
        assert san_pham_cua_don("C", None, self.PAGE_SP) == "(khác)"
        assert san_pham_cua_don(None, None, self.PAGE_SP) == "(khác)"
