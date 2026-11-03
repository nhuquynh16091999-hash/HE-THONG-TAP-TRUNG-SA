"""
Chọn bảng/view BigQuery cần làm mới hạn trước khi sandbox tự xoá (03/11/2026).

Chạy: python3 -m pytest tests/test_gia_han_bq.py -q

cty-507710 chưa bật billing nên mọi bảng/view tự xoá 60 ngày sau lúc tạo — 04/11/2026 suýt mất
fb_ads_data, fb_campaign_data, product_catalog… Xem sync/core/gia_han_bq.py.
"""
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sync.core.gia_han_bq import chon_can_lam_moi  # noqa: E402

NOW = datetime(2026, 12, 23, 3, 0, tzinfo=timezone.utc)
CON = lambda ngay: NOW + timedelta(days=ngay)  # noqa: E731


def test_chi_lam_moi_thu_con_duoi_10_ngay():
    ds = [("fb_ads_data", "TABLE", CON(9)), ("sale_order", "TABLE", CON(11)), ("vw_orders_std", "VIEW", CON(2))]
    assert chon_can_lam_moi(ds, NOW) == ["fb_ads_data", "vw_orders_std"]


def test_bang_khong_han_thi_bo_qua():
    # inventory_snapshot không có hạn — đụng vào là tự tạo việc vô ích.
    assert chon_can_lam_moi([("inventory_snapshot", "TABLE", None)], NOW) == []


def test_bang_cu_da_thay_de_tu_het_han():
    # Bảng cũ sau khi thay phải được để cho chết — làm mới nó là giữ rác mãi mãi.
    ds = [("fb_ads_data__cu_20261103", "TABLE", CON(1)), ("fb_ads_data", "TABLE", CON(1))]
    assert chon_can_lam_moi(ds, NOW) == ["fb_ads_data"]


def test_bang_tam_sot_lai_khong_lam_moi():
    assert chon_can_lam_moi([("fb_ads_data__moi", "TABLE", CON(1))], NOW) == []


def test_bang_sao_luu_cung_duoc_lam_moi():
    # TALPHA_SaoLuu (fb_ads_data__20261103, meta_ad__20261103…) cũng tự xoá — phải giữ.
    assert chon_can_lam_moi([("meta_ad__20261103", "TABLE", CON(3))], NOW) == ["meta_ad__20261103"]


def test_loai_khac_khong_dung_den():
    assert chon_can_lam_moi([("anh_chup", "SNAPSHOT", CON(1)), ("ngoai", "EXTERNAL", CON(1))], NOW) == []
