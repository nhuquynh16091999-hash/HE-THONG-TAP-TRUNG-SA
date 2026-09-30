"""
TKQC fetch hỏng: cái nào BỎ QUA được mà vẫn ghi Sheet, cái nào phải CHẶN cả vòng.

Sỹ Anh chốt 30/09/2026. Luật 03/09 ("sync hỏng thì không ghi Sheet") chặn vòng ghi khi chỉ
MỘT TKQC đọc lỗi, để Sheet không ghi đè số thiếu. Đúng khi TK đó đang tiêu tiền. Nhưng
trong tháng 9 luật này làm Sheet đứng bốn lần (12/09, 22/09, 23/09, 30/09) chỉ vì chủ TK
gỡ quyền của những TK KHÔNG tiêu đồng nào. Lần 30/09 TK "K NEED khang ve 22" (0đ cả tháng)
làm Sheet đứng 20 giờ và tin Zalo 13:00 in "Ads 0đ · 0 đơn".

Nay TK được BỎ QUA khi đủ CẢ HAI điều kiện:
  * lỗi là MẤT QUYỀN (Meta #200 has NOT grant…), không phải lỗi mạng hay rate limit;
  * BO_QUA_NGAY ngày gần nhất TK đó tiêu 0đ trong fb_ads_data, nên bỏ nó không thiếu số nào.
TK bị bỏ qua vẫn được báo tên lên Zalo (nhãn TKQC_BO_QUA trong daily_guarded.sh) để người
ta cấp lại quyền hoặc gỡ TK khỏi config/projects/talpha.yaml. TK đang tiêu tiền mà lỗi thì
vẫn CHẶN như cũ.
"""

# Đổi số này thì sửa cả câu trong tin Zalo (ops/zalo-alerts/daily_report.js → ghiChuBoQua).
BO_QUA_NGAY = 7


def tach_tk_loi(failed, chi_gan_day):
    """Chia TKQC fetch hỏng thành (bo_qua, chan).

    failed      — [{"name", "id", "mat_quyen"}], id dạng "act_123" hoặc "123".
    chi_gan_day — {account_id KHÔNG có "act_": tổng spend BO_QUA_NGAY ngày gần nhất}.
                  TK vắng mặt = chưa có dòng nào = 0đ. None = không tra được → mọi TK lỗi
                  đều CHẶN: thà Sheet đứng còn hơn ghi số thiếu mà không biết.
    """
    if chi_gan_day is None:
        return [], list(failed)
    bo_qua, chan = [], []
    for f in failed:
        tien = float(chi_gan_day.get(str(f["id"]).replace("act_", ""), 0) or 0)
        (bo_qua if f.get("mat_quyen") and tien <= 0 else chan).append(f)
    return bo_qua, chan
