"""
TKQC đọc lỗi thì sync BỎ QUA, vẫn ghi Sheet bằng các TK còn lại (28/10/2026).

Chạy: python3 -m pytest tests/test_sync_tk_mat_quyen.py -q

Sỹ Anh chốt 28/10: "tkqc nào die thì kệ nó, mày vẫn cứ báo cáo các tkqc còn lại". Luật cũ
(30/09) chỉ bỏ qua TK mất quyền mà 7 ngày không tiêu → 14/10 SA ANTALO 01 bị khoá lúc đang chạy,
Sheet đứng 23 giờ. Nay chỉ chặn khi KHÔNG TK nào đọc được (token chết / app bị chặn).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sync.core.tk_loi import tach_tk_loi  # noqa: E402

SA01 = {"name": "SA ANTALO 01", "id": "act_2201353496727281", "mat_quyen": True}
ANTALO1 = {"name": "ANTALO 1 - CHẠY ĐÀI", "id": "act_191133507087352", "mat_quyen": True}
MANG = {"name": "Sỹ Anh Taiwan 4", "id": "act_256210853826298", "mat_quyen": False}


def test_khong_tk_nao_loi_thi_khong_bo_khong_chan():
    assert tach_tk_loi([], 12) == ([], [])


def test_tk_chet_luc_dang_chay_van_bo_qua():
    # 14/10: SA ANTALO 01 bị khoá khi đang tiêu tiền — luật cũ chặn, Sheet đứng 23 giờ.
    bo_qua, chan = tach_tk_loi([SA01], 11)
    assert bo_qua == [SA01] and chan == []


def test_loi_mang_mot_tk_cung_bo_qua():
    # Dòng cũ của TK lỗi giữ nguyên (append_and_rebuild_ads) nên bỏ qua không ghi số 0.
    bo_qua, chan = tach_tk_loi([MANG], 12)
    assert bo_qua == [MANG] and chan == []


def test_nhieu_tk_chet_van_con_tk_doc_duoc_thi_bo_qua_het():
    bo_qua, chan = tach_tk_loi([SA01, ANTALO1, MANG], 4)
    assert bo_qua == [SA01, ANTALO1, MANG] and chan == []


def test_khong_tk_nao_doc_duoc_thi_chan():
    # Token chết / app bị chặn (02/09, 08/10): ghi Sheet là ghi tiền ads cũ cạnh đơn mới.
    bo_qua, chan = tach_tk_loi([SA01, ANTALO1, MANG], 3)
    assert bo_qua == [] and chan == [SA01, ANTALO1, MANG]
