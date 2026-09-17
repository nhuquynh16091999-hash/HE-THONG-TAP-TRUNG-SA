"""
Đơn TRỐNG (không sản phẩm, 0 tiền) không tính vào số đơn — Sỹ Anh chốt 17/09/2026.

Chạy: python3 -m pytest tests/test_talpha_don_trong.py -q

Ngày 15/09 báo cáo Đài ghi Lộc 3 đơn, POS 2: đơn #381 không sản phẩm, 0 TWD, không tag marketer,
bị gán cho Lộc theo page. Cả tháng 9 shop Đài có ~87 đơn kiểu này, số đơn thổi lên ~4 lần.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "ops" / "talpha_reports"))

from talpha_rules import la_don_trong, sql_la_don_trong  # noqa: E402


def test_don_381_la_don_trong():
    # dữ liệu thật của #381 trong bảng đơn: total_quantity là chuỗi "0", tiền 0
    assert la_don_trong("0", 0.0, 0.0) is True


def test_o_trong_coi_nhu_0():
    assert la_don_trong(None, None, None) is True
    assert la_don_trong("", "", "") is True


def test_don_that_co_hang_co_tien_thi_tinh():
    assert la_don_trong("1", 799.0, 799.0) is False


def test_co_tien_ma_chua_ghi_so_luong_van_tinh():
    # chỉ bỏ khi KHÔNG hàng VÀ KHÔNG tiền — thiếu một trong hai là vẫn là đơn
    assert la_don_trong("0", 0.0, 999.0) is False
    assert la_don_trong("0", 1299.0, 0.0) is False


def test_co_hang_nhung_0_dong_van_tinh():
    # đơn tặng / đổi hàng: có sản phẩm mà 0 đồng — vẫn là đơn thật
    assert la_don_trong("2", 0.0, 0.0) is False


def test_so_luong_la_chu_la_khong_doan():
    assert la_don_trong("abc", 0, 0) is False


def test_sql_cung_dieu_kien():
    sql = sql_la_don_trong()
    assert "IFNULL(SAFE_CAST(total_quantity AS FLOAT64), 0) = 0" in sql
    assert "IFNULL(total_price, 0) = 0" in sql and "IFNULL(cod, 0) = 0" in sql
    assert "t.total_price" in sql_la_don_trong("t")
