"""
TKQC mất quyền mà 7 ngày không tiêu đồng nào thì sync BỎ QUA, vẫn ghi Sheet (30/09/2026).

Chạy: python3 -m pytest tests/test_sync_tk_mat_quyen.py -q

Sỹ Anh chốt sau lần thứ tư trong tháng 9 Sheet đứng chỉ vì một TK 0đ bị gỡ quyền (30/09:
"K NEED khang ve 22", Sheet đứng 20 giờ, tin Zalo 13:00 in "Ads 0đ · 0 đơn"). TK đang tiêu
tiền mà lỗi thì vẫn chặn như luật 03/09.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sync.core.tk_loi import tach_tk_loi  # noqa: E402

KNEED = {"name": "K NEED khang ve 22", "id": "act_2201353496727281", "mat_quyen": True}
ANTALO1 = {"name": "ANTALO 1 - CHẠY ĐÀI", "id": "act_191133507087352", "mat_quyen": True}
MANG = {"name": "Sỹ Anh Taiwan 4", "id": "act_256210853826298", "mat_quyen": False}


def test_mat_quyen_va_khong_chi_thi_bo_qua():
    # TK chưa có dòng nào trong fb_ads_data → vắng mặt trong dict = 0đ.
    bo_qua, chan = tach_tk_loi([KNEED], {})
    assert bo_qua == [KNEED] and chan == []


def test_mat_quyen_ma_dang_chi_thi_van_chan():
    # 29/09: ANTALO 1 bị đá khỏi BM khi đang chạy — bỏ qua là Sheet thiếu tiền ads thật.
    bo_qua, chan = tach_tk_loi([ANTALO1], {"191133507087352": 1_250_000.0})
    assert bo_qua == [] and chan == [ANTALO1]


def test_loi_mang_khong_bao_gio_bo_qua_du_khong_chi():
    bo_qua, chan = tach_tk_loi([MANG], {})
    assert bo_qua == [] and chan == [MANG]


def test_khong_tra_duoc_chi_tieu_thi_chan_het():
    bo_qua, chan = tach_tk_loi([KNEED, ANTALO1], None)
    assert bo_qua == [] and chan == [KNEED, ANTALO1]


def test_tron_ca_hai_loai():
    bo_qua, chan = tach_tk_loi([KNEED, ANTALO1], {"191133507087352": 90_000.0, "2201353496727281": 0.0})
    assert bo_qua == [KNEED] and chan == [ANTALO1]


def test_id_co_hay_khong_co_act_deu_khop():
    tk = {**ANTALO1, "id": "191133507087352"}
    _, chan = tach_tk_loi([tk], {"191133507087352": 5.0})
    assert chan == [tk]
