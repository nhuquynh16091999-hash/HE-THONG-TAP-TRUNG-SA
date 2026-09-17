"""
Đồng bộ POS thêm cột SAU khi bảng đơn đã có dữ liệu (17/09/2026: page_name, seller_name).

Chạy: python3 -m pytest tests/test_sync_dien_nguoc_cot_moi.py -q

Bảng đơn chỉ nối vào raw những đơn đổi `updated_at`. Thêm cột mà không điền ngược thì đơn cũ
không đổi trạng thái mang NULL mãi — báo cáo nối đơn → campaign bằng tên page sẽ đẩy cả loạt
đơn đầu tháng vào tab CHƯA MAP dù POS có đủ tên page.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sync.core.bq_writer import chon_don_can_ghi  # noqa: E402


def don(id_, updated, page="", seller=""):
    return {"shop_id": "1022091930", "id": id_, "updated_at": updated, "page_name": page, "seller_name": seller}


KNOWN = {"1022091930|1": "2026-09-10T01:00", "1022091930|2": "2026-09-10T01:00"}


def test_luat_cu_chi_noi_don_moi_hoac_doi_trang_thai():
    ds = [don("1", "2026-09-10T01:00", "Page A"), don("2", "2026-09-12T01:00", "Page B"), don("3", "2026-09-12T01:00")]
    assert [o["id"] for o in chon_don_can_ghi(ds, KNOWN)] == ["2", "3"]


def test_bang_chua_co_cot_moi_thi_noi_lai_ca_cua_so():
    ds = [don("1", "2026-09-10T01:00", "Page A"), don("2", "2026-09-10T01:00")]
    assert [o["id"] for o in chon_don_can_ghi(ds, KNOWN, thieu_cot=True)] == ["1", "2"]


def test_bang_dang_trong_cot_ma_pos_da_co_thi_dien_nguoc():
    trong = {"page_name": {"1022091930|1", "1022091930|2"}, "seller_name": set()}
    ds = [don("1", "2026-09-10T01:00", "Page A"), don("2", "2026-09-10T01:00", "")]
    # đơn 2: POS cũng trống tên page → không nối lại vô ích mỗi giờ
    assert [o["id"] for o in chon_don_can_ghi(ds, KNOWN, trong=trong)] == ["1"]


def test_da_dien_roi_thi_thoi():
    ds = [don("1", "2026-09-10T01:00", "Page A", "Thương Thương")]
    assert chon_don_can_ghi(ds, KNOWN, trong={"page_name": set(), "seller_name": set()}) == []


def test_sale_duoc_gan_sau_cung_duoc_dien():
    ds = [don("1", "2026-09-10T01:00", "Page A", "Chun Ho")]
    trong = {"page_name": set(), "seller_name": {"1022091930|1"}}
    assert [o["id"] for o in chon_don_can_ghi(ds, KNOWN, trong=trong)] == ["1"]
