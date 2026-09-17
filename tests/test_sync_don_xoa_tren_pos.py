"""
Đơn bị XOÁ trên POS phải rời bảng đơn (17/09/2026).

Chạy: python3 -m pytest tests/test_sync_don_xoa_tren_pos.py -q

Sỹ Anh soi ngày 14/09 page Lucky Silver Philippines: Sheet 6 đơn, POS thật 3. Ba đơn thừa
(#59–#61, 0 SGD) đã bị xoá trên POS nhưng bảng đơn chỉ ghi thêm nên giữ chúng mãi. Cả shop
Singapore có 10 đơn như vậy; shop Đài 0.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sync.core.bq_writer import DA_XOA_TREN_POS, chon_don_da_xoa, sql_rebuild_orders  # noqa: E402

SG = "715135541"
TW = "1022091930"
MOC = "2026-09-13T17:00:00"


def test_don_trong_cua_so_ma_pos_khong_con_thi_danh_dau_xoa():
    trong_bang = [(SG, "59", "2026-09-14T12:41:44"), (SG, "77", "2026-09-14T01:34:00"),
                  (SG, "60", "2026-09-14T12:42:02")]
    xoa, canh_bao = chon_don_da_xoa(trong_bang, {SG: (MOC, {"77", "78", "79"})})
    assert sorted(xoa) == [(SG, "59"), (SG, "60")] and canh_bao == []


def test_don_cu_hon_cua_so_khong_dung_toi():
    # Cửa sổ chỉ kéo từ MOC — đơn cũ hơn POS không trả về là chuyện bình thường, không phải bị xoá.
    xoa, _ = chon_don_da_xoa([(SG, "12", "2026-09-01T03:00:00")], {SG: (MOC, {"77"})})
    assert xoa == []


def test_shop_keo_hong_khong_nam_trong_da_thay_thi_khong_dung_toi():
    xoa, _ = chon_don_da_xoa([(TW, "5", "2026-09-14T00:00:00")], {SG: (MOC, {"77"})})
    assert xoa == []


def test_pos_tra_0_don_thi_khong_xoa_gi():
    xoa, canh_bao = chon_don_da_xoa([(SG, "77", "2026-09-14T01:34:00")], {SG: (MOC, set())})
    assert xoa == [] and "POS trả 0 đơn" in canh_bao[0]


def test_mat_qua_nhieu_mot_luot_thi_nghi_pos_tra_thieu():
    trong_bang = [(TW, str(i), "2026-09-14T00:00:00") for i in range(100)]
    thay = {str(i) for i in range(60)}                       # POS "mất" 40 đơn một lượt
    xoa, canh_bao = chon_don_da_xoa(trong_bang, {TW: (MOC, thay)})
    assert xoa == [] and "nghi POS trả thiếu" in canh_bao[0]


def test_it_don_bi_xoa_van_dung_nguong_toi_thieu():
    trong_bang = [(SG, str(i), "2026-09-14T00:00:00") for i in range(25)]
    thay = {str(i) for i in range(15)}                       # 10 đơn xoá, POS còn 15: dưới ngưỡng 20
    xoa, canh_bao = chon_don_da_xoa(trong_bang, {SG: (MOC, thay)})
    assert len(xoa) == 10 and canh_bao == []


def test_dung_lai_bang_bo_dong_danh_dau_xoa_va_van_loc_shop():
    sql = sql_rebuild_orders("p", "d", "sale_order", [TW, SG])
    assert f"IFNULL(status_name, '') != '{DA_XOA_TREN_POS}'" in sql
    assert "ORDER BY updated_at DESC, sync_time DESC" in sql     # dòng đánh dấu cùng updated_at, sync_time mới hơn → thắng
    assert f"WHERE t.shop_id IN ('{TW}', '{SG}')" in sql
