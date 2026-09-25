"""
Tab sản phẩm trong file Sheet: đọc tên campaign, nối đơn POS → camp THEO NGUỒN ĐƠN (tên page).

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

from talpha_rules import (  # noqa: E402
    camp_san_pham, chuan_ten_page, tao_chi_muc_page, tim_camp_theo_page,
    o_trang_cua_camp, tao_ten_tab_page, ten_tab_cua_don,
)


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


class TestKhopNguonDonVoiTenPageTrongCamp:
    """Luật Sỹ Anh chốt 17/09/2026: nguồn đơn POS → ô tên page trong tên camp → camp."""
    ADS = [
        ("SGP/LOC/PHI/040/Lucky Silver Philippines/13-9", "2026-09-13", 300000),
        ("SGP/LOC/PHI/040/𝑺𝒂𝒖𝒅𝒊 𝑮𝒐𝒍𝒅𝒆𝒏 𝑩𝒓𝒂𝒄𝒆𝒍𝒆𝒕/15-9", "2026-09-15", 200000),
        ("TW/THAI/INDO/SET KC/Master Jewelry Gold - TW - 02/09", "2026-09-02", 100000),
        ("TW/THAI/PHI/Jewelry GJ International - TW - 05/09", "2026-09-05", 500000),
        # một page, hai người nối nhau: Thắng đầu tháng, Thương từ 14/09
        ("TW/THẮNG /TỆP PHI/VÒNG MAY MẮN/𝐁𝐢𝐲𝐚𝐲𝐚 𝐓𝐖/1258963223972395/4-9 TEST", "2026-09-04", 400000),
        ("TW/THẮNG /TỆP PHI/VÒNG MAY MẮN/𝐁𝐢𝐲𝐚𝐲𝐚 𝐓𝐖/1258963223972395/4-9 TEST", "2026-09-10", 300000),
        ("TW/THUONG/PHI/071/𝐁𝐢𝐲𝐚𝐲𝐚 𝐓𝐖/14-9", "2026-09-14", 250000),
        ("Ai do/khong ro/xyz", "2026-09-14", 999),
    ]
    CM = tao_chi_muc_page(ADS)

    def test_chuan_hoa_ten_page(self):
        assert chuan_ten_page("𝑺𝒂𝒖𝒅𝒊 𝑮𝒐𝒍𝒅𝒆𝒏 𝑩𝒓𝒂𝒄𝒆𝒍𝒆𝒕") == "saudi golden bracelet"
        assert chuan_ten_page("  Master Jewelry Gold&Diamond - TW ") == "master jewelry gold diamond tw"
        assert chuan_ten_page(None) == ""

    def test_trung_ten_page(self):
        assert tim_camp_theo_page("Lucky Silver Philippines", "2026-09-16", self.CM) == \
            ("SGP/LOC/PHI/040/Lucky Silver Philippines/13-9", "dung_ten")
        # POS và camp khác kiểu chữ vẫn khớp
        assert tim_camp_theo_page("Saudi Golden Bracelet", "2026-09-16", self.CM)[1] == "dung_ten"

    def test_ngay_dinh_vao_ten_page(self):
        assert tim_camp_theo_page("Master Jewelry Gold - TW", "2026-09-03", self.CM) == \
            ("TW/THAI/INDO/SET KC/Master Jewelry Gold - TW - 02/09", "dau_ten")

    def test_ten_page_nam_lech_o_san_pham(self):
        assert tim_camp_theo_page("Jewelry GJ International", "2026-09-06", self.CM) == \
            ("TW/THAI/PHI/Jewelry GJ International - TW - 05/09", "lech_o")

    def test_page_nhieu_camp_chon_camp_chay_dung_ngay_don(self):
        thang = "TW/THẮNG /TỆP PHI/VÒNG MAY MẮN/𝐁𝐢𝐲𝐚𝐲𝐚 𝐓𝐖/1258963223972395/4-9 TEST"
        thuong = "TW/THUONG/PHI/071/𝐁𝐢𝐲𝐚𝐲𝐚 𝐓𝐖/14-9"
        assert tim_camp_theo_page("𝐁𝐢𝐲𝐚𝐲𝐚 𝐓𝐖", "2026-09-10", self.CM)[0] == thang
        assert tim_camp_theo_page("𝐁𝐢𝐲𝐚𝐲𝐚 𝐓𝐖", "2026-09-12", self.CM)[0] == thang    # ngày có tiền gần nhất trước đó
        assert tim_camp_theo_page("𝐁𝐢𝐲𝐚𝐲𝐚 𝐓𝐖", "2026-09-15", self.CM)[0] == thuong

    def test_page_nhieu_camp_uu_tien_quang_cao_cua_don(self):
        thuong = "TW/THUONG/PHI/071/𝐁𝐢𝐲𝐚𝐲𝐚 𝐓𝐖/14-9"
        assert tim_camp_theo_page("𝐁𝐢𝐲𝐚𝐲𝐚 𝐓𝐖", "2026-09-10", self.CM, camp_quang_cao=thuong)[0] == thuong

    def test_don_truoc_moi_camp_lay_camp_tieu_nhieu_nhat(self):
        thang = "TW/THẮNG /TỆP PHI/VÒNG MAY MẮN/𝐁𝐢𝐲𝐚𝐲𝐚 𝐓𝐖/1258963223972395/4-9 TEST"
        assert tim_camp_theo_page("𝐁𝐢𝐲𝐚𝐲𝐚 𝐓𝐖", "2026-09-01", self.CM)[0] == thang

    def test_chi_nhan_camp_cung_nuoc_voi_shop(self):
        # 17/09/2026: một page chạy cả camp Đài lẫn Singapore — đơn shop Đài không được nối
        # vào camp Singapore (đơn Đài #381 từng làm Lộc ra 3 đơn ngày 15/09, POS chỉ 2).
        cm = tao_chi_muc_page([
            ("SGP/LOC/PHI/040/Lucky Silver Philippines/13-9", "2026-09-13", 300000),
            ("TW/THAI/PHI/040/Lucky Silver Philippines/14-9", "2026-09-14", 100000),
        ])
        assert tim_camp_theo_page("Lucky Silver Philippines", "2026-09-15", cm, nuoc="Taiwan")[0] == \
            "TW/THAI/PHI/040/Lucky Silver Philippines/14-9"
        assert tim_camp_theo_page("Lucky Silver Philippines", "2026-09-15", cm, nuoc="Singapore")[0] == \
            "SGP/LOC/PHI/040/Lucky Silver Philippines/13-9"
        # Page chỉ có camp nước khác → không khớp, không nhận nhầm.
        assert tim_camp_theo_page("Lucky Silver Philippines", "2026-09-15", self.CM, nuoc="Taiwan") == \
            (None, "khong_khop")

    def test_khong_khop_va_khong_co_nguon(self):
        assert tim_camp_theo_page("HongKong Golden Bracelet", "2026-09-10", self.CM) == (None, "khong_khop")
        assert tim_camp_theo_page("", "2026-09-10", self.CM) == (None, "khong_co_nguon")
        assert tim_camp_theo_page(None, "2026-09-10", self.CM) == (None, "khong_co_nguon")


class TestTenTabTheoPage:
    """Sỹ Anh chốt 17/09/2026: mỗi page một tab, đặt theo tên page (tab "040" gộp hai page khác nhau)."""
    POS = ["Lucky Silver Philippines", "Lucky Silver Philippines", "𝑺𝒂𝒖𝒅𝒊 𝑮𝒐𝒍𝒅𝒆𝒏 𝑩𝒓𝒂𝒄𝒆𝒍𝒆𝒕",
           "Lumora Jewelry Store", "Jewelry GJ International", "Master Jewelry Gold - TW",
           "Master Jewelry Gold&Diamond"]
    POS_TEN, CAMP_TAB = tao_ten_tab_page(POS, [
        "SGP/LOC/PHI/040/Lucky Silver Philippines/13-9",
        "SGP/LOC/PHI/040/𝑺𝒂𝒖𝒅𝒊 𝑮𝒐𝒍𝒅𝒆𝒏 𝑩𝒓𝒂𝒄𝒆𝒍𝒆𝒕/15-9",
        "TW/THAI/INDO/040 - VONGVANG1/Lumora Jewelry Store - 05/9 - 2",
        "TW/THÁI/INDO/040 - VONGVANG1/ Lumora Jewelry Store/31/08 vd2",
        "TW/THAI/PHI/Jewelry GJ International - TW - 05/09",
        "Thainx/INDO/SET KC/Master Jewelry Gold - TW - 02/09",
        "Thainx/INDO/SET 13/Master Jewelry Gold&Diamond - 03/09 -02",
        "Thainx/Philippine/SET KIM CƯƠNG/ LuxeGold Jewelry - 27/08",
        "TW/THÁI/Philippine/SET KIM CƯƠNG/ LuxeGold Jewelry/ 01/09",
        "TW/LOC/PHI/𝑻𝒉𝒆 𝑳𝒆𝒂𝒕𝒉𝒆𝒓 𝑨𝒕𝒆𝒍𝒊𝒆𝒓 𝑺𝒉𝒐𝒑/13-9/TEST",
        "TW/Loc/1303370732848505/Taiwan Prime Leather/2808",
        "TW/THÁI/VIỆT/Vòng/Vượng Khí Các - TW - 25/09",
        "Ai do/khong ro/xyz",
    ])

    def test_hai_page_cung_ma_san_pham_la_hai_tab(self):
        assert self.CAMP_TAB["SGP/LOC/PHI/040/Lucky Silver Philippines/13-9"] == "Lucky Silver Philippines"
        assert self.CAMP_TAB["SGP/LOC/PHI/040/𝑺𝒂𝒖𝒅𝒊 𝑮𝒐𝒍𝒅𝒆𝒏 𝑩𝒓𝒂𝒄𝒆𝒍𝒆𝒕/15-9"] == "𝑺𝒂𝒖𝒅𝒊 𝑮𝒐𝒍𝒅𝒆𝒏 𝑩𝒓𝒂𝒄𝒆𝒍𝒆𝒕"

    def test_ten_page_dinh_ngay_ve_tab_cua_page_tren_pos(self):
        assert self.CAMP_TAB["TW/THAI/INDO/040 - VONGVANG1/Lumora Jewelry Store - 05/9 - 2"] == "Lumora Jewelry Store"
        assert self.CAMP_TAB["TW/THÁI/INDO/040 - VONGVANG1/ Lumora Jewelry Store/31/08 vd2"] == "Lumora Jewelry Store"

    def test_nhieu_page_pos_cung_khop_lay_ten_cu_the_nhat(self):
        assert self.CAMP_TAB["Thainx/INDO/SET KC/Master Jewelry Gold - TW - 02/09"] == "Master Jewelry Gold - TW"
        assert self.CAMP_TAB["Thainx/INDO/SET 13/Master Jewelry Gold&Diamond - 03/09 -02"] == "Master Jewelry Gold&Diamond"

    def test_ten_page_ghi_lech_sang_o_san_pham(self):
        assert self.CAMP_TAB["TW/THAI/PHI/Jewelry GJ International - TW - 05/09"] == "Jewelry GJ International"
        assert self.CAMP_TAB["TW/LOC/PHI/𝑻𝒉𝒆 𝑳𝒆𝒂𝒕𝒉𝒆𝒓 𝑨𝒕𝒆𝒍𝒊𝒆𝒓 𝑺𝒉𝒐𝒑/13-9/TEST"] == "𝑻𝒉𝒆 𝑳𝒆𝒂𝒕𝒉𝒆𝒓 𝑨𝒕𝒆𝒍𝒊𝒆𝒓 𝑺𝒉𝒐𝒑"

    def test_page_chua_co_don_pos_thi_dung_ten_trong_camp_va_gop_bien_the(self):
        assert self.CAMP_TAB["Thainx/Philippine/SET KIM CƯƠNG/ LuxeGold Jewelry - 27/08"] == "LuxeGold Jewelry"
        assert self.CAMP_TAB["TW/THÁI/Philippine/SET KIM CƯƠNG/ LuxeGold Jewelry/ 01/09"] == "LuxeGold Jewelry"
        assert self.CAMP_TAB["TW/Loc/1303370732848505/Taiwan Prime Leather/2808"] == "Taiwan Prime Leather"
        # ngày "25/09" bị dấu / cắt, "25" dính đuôi tên page
        assert self.CAMP_TAB["TW/THÁI/VIỆT/Vòng/Vượng Khí Các - TW - 25/09"] == "Vượng Khí Các - TW"

    def test_camp_khong_nhan_ra_marketer(self):
        assert self.CAMP_TAB["Ai do/khong ro/xyz"] is None
        assert o_trang_cua_camp("Ai do/khong ro/xyz") == (None, [])

    def test_ten_tab_cua_don_theo_cach_viet_pho_bien_tren_pos(self):
        assert ten_tab_cua_don(" lucky silver PHILIPPINES", self.POS_TEN) == "Lucky Silver Philippines"
        assert ten_tab_cua_don("Page Lạ Chưa Gặp", self.POS_TEN) == "Page Lạ Chưa Gặp"
        assert ten_tab_cua_don("", self.POS_TEN) is None
        assert ten_tab_cua_don(None, self.POS_TEN) is None
