"""
Đổi shop POS Đài Loan sang "TAIWAN SỸ ANH" (1022091930) — 14/09/2026.

Chạy: python3 -m pytest tests/test_talpha_doi_shop_pos.py -q

Canh hai chỗ làm sai số nếu trượt:
  • Đơn ghi bằng VND trong shop TWD — để nguyên thì bị nhân tỷ giá thành hàng trăm
    triệu, bỏ đi thì mất cả tuần đơn đầu tháng.
  • Hai shop cùng nhãn "TW" dùng chung mã đơn 1…281 — khoá theo nhãn là nhập đơn của
    hai shop khác nhau làm một, và đơn shop cũ lọt vào báo cáo của shop mới.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sync.core.business_rules import quy_doi_don_ngoai_te, revenue_vnd  # noqa: E402
from sync.core.bq_writer import _loc_shop, sql_rebuild_orders  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "ops" / "talpha_reports"))
from talpha_rules import norm_pos_nv  # noqa: E402


def _don(**kw):
    base = {"id": "A715108714.2", "order_currency": "VND", "cod": 1_210_000.0,
            "total_price": 0.0, "shipping_fee": 1_210_000.0, "money_to_collect": 1_210_000.0}
    base.update(kw)
    return base


class TestDonVndTrongShopTwd:
    def test_don_twd_giu_nguyen(self):
        don = _don(order_currency="TWD", cod=799.0, total_price=799.0, shipping_fee=0.0)
        ra = quy_doi_don_ngoai_te(don, [], "TWD", 800)
        assert ra is not None and ra[0] is don

    def test_don_khong_ghi_loai_tien_coi_la_tien_shop(self):
        don = _don(order_currency=None, cod=999.0)
        assert quy_doi_don_ngoai_te(don, [], "TWD", 800)[0]["cod"] == 999.0

    def test_don_vnd_quy_ve_twd_va_doanh_thu_ra_dung_so_goc(self):
        # Đơn thật shop 1022091930: 1.210.000đ ghi ở ô phí vận chuyển.
        don, _ = quy_doi_don_ngoai_te(_don(), [], "TWD", 800)
        assert don["order_currency"] == "TWD"
        assert don["cod"] == 1512.5
        assert revenue_vnd(don["cod"], "TW") == 1_210_000.0

    def test_moi_khoan_tien_deu_quy_doi(self):
        don, _ = quy_doi_don_ngoai_te(_don(total_discount=80_000.0), [], "TWD", 800)
        assert don["shipping_fee"] == 1512.5 and don["money_to_collect"] == 1512.5
        assert don["total_discount"] == 100.0

    def test_khong_sua_vao_don_goc(self):
        goc = _don()
        quy_doi_don_ngoai_te(goc, [], "TWD", 800)
        assert goc["cod"] == 1_210_000.0 and goc["order_currency"] == "VND"

    def test_dong_hang_quy_doi_gia_ban_nhung_khong_dung_gia_nhap(self):
        item = {"order_id": "A715108714.2", "retail_price": 640_000.0, "avg_imported_price": 95.0}
        _, items = quy_doi_don_ngoai_te(_don(), [item], "TWD", 800)
        assert items[0]["retail_price"] == 800.0
        assert items[0]["avg_imported_price"] == 95.0

    def test_loai_tien_khac_thi_bo_khong_doan_ty_gia(self):
        assert quy_doi_don_ngoai_te(_don(order_currency="USD"), [], "TWD", 800) is None

    def test_shop_khong_co_ty_gia_thi_bo(self):
        assert quy_doi_don_ngoai_te(_don(), [], "TWD", None) is None
        assert quy_doi_don_ngoai_te(_don(), [], "TWD", 0) is None


class TestBangDonChiGomShopDangKhai:
    def test_khoa_theo_shop_id_khong_theo_nhan(self):
        sql = sql_rebuild_orders("p", "d", "sale_order", ["1022091930"])
        assert "PARTITION BY shop_id, id" in sql
        assert "shop_label" not in sql

    def test_loc_dung_shop_dang_khai(self):
        sql = sql_rebuild_orders("p", "d", "sale_order", ["1022091930"])
        assert "WHERE t.shop_id IN ('1022091930')" in sql
        assert "408074608" not in sql

    def test_thieu_ma_shop_thi_khong_loc(self):
        # Thiếu mã thì lọc là xoá trắng bảng đơn — thà không lọc.
        assert _loc_shop(None, "t.shop_id") == ""
        assert _loc_shop([], "t.shop_id") == ""
        assert _loc_shop(["1022091930", ""], "t.shop_id") == ""

    def test_ma_shop_la_chu_thi_tu_choi(self):
        with pytest.raises(ValueError):
            _loc_shop(["1022091930') OR ('1'='1"], "t.shop_id")


class TestTenTaiKhoanPos:
    """Tài khoản POS shop mới không mang tên thật (Sỹ Anh xác nhận 15/09/2026)."""

    def test_ba_tai_khoan_gan_dung_nguoi(self):
        assert norm_pos_nv("Chun Ho") == "Loc"
        assert norm_pos_nv("Thanh Ngô Thanh") == "Thai"
        assert norm_pos_nv("Linh Thy Hoang") == "Thang"
        assert norm_pos_nv("Thương Thương") == "Thuong"

    def test_ten_thanh_khac_khong_bi_vo_nham(self):
        assert norm_pos_nv("Nguyễn Thanh") is None
