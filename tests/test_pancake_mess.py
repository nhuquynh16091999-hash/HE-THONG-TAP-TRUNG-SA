"""
Tin nhắn Nhật lấy từ Pancake cho Sheet (Sỹ Anh yêu cầu 09/10/2026) — Meta không báo mess ở Nhật.

Chạy: TALPHA_RULES="$PWD/config/talpha_rules.json" python3 -m pytest tests/test_pancake_mess.py -q
Mẫu hội thoại đúng dạng /api/v1/pages/{id}/conversations trả về ngày 09/10/2026 (UTC không múi).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "ops" / "talpha_reports"))

import pancake_mess as P  # noqa: E402
from talpha_rules import MESS_PANCAKE, camp_san_pham, campaign_market  # noqa: E402

HT = [
    {"id": "a", "type": "INBOX", "inserted_at": "2026-10-08T22:39:09.188", "updated_at": "2026-10-09T03:27:02"},
    {"id": "b", "type": "INBOX", "inserted_at": "2026-10-09T01:41:00", "updated_at": "2026-10-09T06:11:00"},
    {"id": "c", "type": "COMMENT", "inserted_at": "2026-10-08T23:11:24", "updated_at": "2026-10-08T23:11:14"},
    {"id": "d", "type": "INBOX", "inserted_at": "2026-10-08T06:08:39", "updated_at": "2026-10-09T07:29:02"},
    {"id": "b", "type": "INBOX", "inserted_at": "2026-10-09T01:41:00", "updated_at": "2026-10-09T06:11:00"},
]


def test_nhat_lay_tin_nhan_tu_pancake():
    assert MESS_PANCAKE == {"Japan"}


def test_dem_tin_nhan_moi_theo_ngay_vn_bo_binh_luan_va_trung():
    assert P.dem_theo_ngay(HT, "2026-10-01", "2026-10-31") == {"2026-10-09": 2, "2026-10-08": 1}
    assert P.dem_theo_ngay(HT, "2026-10-09", "2026-10-09") == {"2026-10-09": 2}


def test_het_lo_khi_ca_lo_cap_nhat_truoc_moc():
    assert P.het_lo(HT, "2026-10-01") is False
    assert P.het_lo([{"id": "x", "updated_at": "2026-09-30T16:59:00"}], "2026-10-01") is True
    assert P.het_lo([], "2026-10-01") is True


def test_page_cua_nuoc_chi_duoi_ma_shop():
    assert P.la_trang_cua_nuoc("Lucky Charm JP", "JP")
    assert not P.la_trang_cua_nuoc("𝑷𝒓𝒊𝒎𝒆 𝑳𝒆𝒂𝒕𝒉𝒆𝒓 𝑱𝒂𝒑𝒂𝒏", "JP")      # page sản phẩm bán ở Đài
    assert not P.la_trang_cua_nuoc("GoutEase Advance Herbal Spray Japan", "JP")


def test_gan_tin_nhan_cho_camp_tieu_nhieu_nhat_va_ngay_khong_tieu():
    so = {P.chuan_ten_page("Lucky Charm JP"): {"ten": "Lucky Charm JP", "ngay": {"2026-10-08": 6, "2026-10-10": 2}},
          P.chuan_ten_page("Trang Moi JP"): {"ten": "Trang Moi JP", "ngay": {"2026-10-09": 3}}}
    dong = [
        ("JP/THANG/PHI/002-ATTL/Lucky Charm JP/08-10", "2026-10-08", 162262),
        ("JP/THƯƠNG/PHI/002-ATTL/Lucky Charm JP/08-10", "2026-10-08", 5000),
        ("TW/LỘC/PHI/042/Lucky Charm JP/26-9", "2026-10-08", 999999),      # camp nước khác — không tính
    ]
    gan, khong = P.gan_cho_camp(so, dong, lambda cn: campaign_market(cn)[0] == "Japan", lambda cn: camp_san_pham(cn)[1])
    assert gan == {("JP/THANG/PHI/002-ATTL/Lucky Charm JP/08-10", "2026-10-08"): 6,
                   ("JP/THANG/PHI/002-ATTL/Lucky Charm JP/08-10", "2026-10-10"): 2}   # ngày không tiêu → camp trước đó
    assert khong == {"Trang Moi JP": 3}
