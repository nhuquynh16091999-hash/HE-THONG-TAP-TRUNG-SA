"""
TKQC fetch hỏng: cái nào BỎ QUA được mà vẫn ghi Sheet, cái nào phải CHẶN cả vòng.

LUẬT 28/10/2026 (Sỹ Anh: "tkqc nào die thì kệ nó, mày vẫn cứ báo cáo các tkqc còn lại"):
TK đọc lỗi nào cũng BỎ QUA — mất quyền, bị khoá, bị đá khỏi BM, lỗi mạng — vòng vẫn ghi Sheet
bằng các TK còn lại. Chỉ CHẶN khi KHÔNG TK NÀO đọc được: lúc đó là token chết / app bị Meta chặn
(02/09, 08/10), không phải một TK chết, và ghi Sheet là ghi tiền ads cũ cạnh đơn mới.

Vì sao đổi: luật 30/09 chỉ bỏ qua TK mất quyền mà 7 ngày không tiêu đồng nào; TK đang tiêu mà
chết thì vẫn chặn → 14/10 SA ANTALO 01 bị khoá lúc đang chạy, Sheet đứng 23 giờ dù 10 TK khác
vẫn đọc được. TK chết thì không tiêu thêm được nữa, nên bỏ qua không thiếu số.

TK bị bỏ qua KHÔNG mất số: sync ghi kiểu nối-rồi-dựng-lại (append_and_rebuild_ads), dòng cũ của
TK lỗi giữ nguyên bản đọc được gần nhất. Tên TK vẫn được báo lên Zalo (nhãn TKQC_BO_QUA trong
daily_guarded.sh) để biết mà gỡ khỏi config/projects/talpha.yaml.
"""


def tach_tk_loi(failed, so_tk):
    """Chia TKQC fetch hỏng thành (bo_qua, chan).

    failed — [{"name", "id", "mat_quyen"}].
    so_tk  — số TKQC cả vòng (kể cả TK đọc được).
    """
    if failed and len(failed) >= so_tk:
        return [], list(failed)
    return list(failed), []
