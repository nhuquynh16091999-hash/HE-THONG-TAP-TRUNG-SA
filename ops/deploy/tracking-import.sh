#!/usr/bin/env bash
#
# Nạp bảng đơn đối tác (Google Sheet NAZA) vào kho `tracking`.
# Chạy bởi systemd unit talpha-tracking.service — mỗi sáng 6h giờ Việt Nam.
# Chạy tay: bash /opt/talpha/ops/deploy/tracking-import.sh
#
# Gọi CHÍNH route dashboard đang dùng (nút "Đọc bảng đối tác"), không viết bản đọc
# Sheet thứ hai: hai bản đọc là sớm muộn hai cách hiểu cùng một file.
set -uo pipefail

PORT="${PORT:-3000}"
URL="${TALPHA_TRACKING_URL:-http://127.0.0.1:${PORT}/api/talpha/tracking/import}"

# KHÔNG `curl | head`: head đóng ống sớm, curl dính SIGPIPE và việc nền báo hỏng dù
# đã nạp xong. Giữ nguyên chuỗi trả về rồi tự cắt cho gọn log.
kq=$(curl -sS -X POST --max-time 300 "$URL") || { echo "curl lỗi khi gọi $URL"; exit 1; }
echo "${kq:0:900}"

# Route trả JSON có "error" khi Sheet đổi tên cột, mất quyền đọc, hay file rỗng. Đó là
# hỏng THẬT — phải để unit đỏ, nếu không thì hỏng âm thầm cả tháng mà màn hình vẫn
# hiện số cũ như số hôm nay.
if printf '%s' "$kq" | grep -q '"error"'; then
    echo "→ nạp THẤT BẠI (xem thông báo ở trên)"
    exit 1
fi
