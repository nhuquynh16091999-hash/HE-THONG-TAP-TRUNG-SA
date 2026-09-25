#!/usr/bin/env bash
#
# Việc buổi sáng của sổ vận đơn — chạy bởi systemd talpha-tracking.service, 6h giờ VN:
#   1. Nạp bảng đơn đối tác (Google Sheet NAZA) vào kho `tracking`.
#   2. Đồng bộ 17TRACK cho Đài Loan rồi từng nước trong tracking.markets (Singapore…): đăng ký đơn mới (TỐN QUOTA — luật chọn ở planRegister, không bao
#      giờ quá quota còn lại) rồi hỏi trạng thái (miễn phí). Chưa có khoá TRACK17_API_KEY
#      thì bỏ qua, không tính là hỏng.
# Chạy tay: bash /opt/talpha/ops/deploy/tracking-import.sh
#
# Gọi CHÍNH route dashboard đang dùng (nút "Đọc bảng đối tác", "Đồng bộ 17TRACK"), không
# viết bản thứ hai: hai bản đọc là sớm muộn hai cách hiểu cùng một file.
# Bước 1 hỏng vẫn chạy bước 2 — 17TRACK không cần bảng đối tác mới để cập nhật đơn đã đăng ký.
set -uo pipefail

PORT="${PORT:-3000}"
BASE="${TALPHA_BASE_URL:-http://127.0.0.1:${PORT}}"
URL="${TALPHA_TRACKING_URL:-${BASE}/api/talpha/tracking/import}"
rc=0

# KHÔNG `curl | head`: head đóng ống sớm, curl dính SIGPIPE và việc nền báo hỏng dù
# đã nạp xong. Giữ nguyên chuỗi trả về rồi tự cắt cho gọn log.
echo "── 1/2 · Nạp bảng đối tác"
if kq=$(curl -sS -X POST --max-time 300 "$URL"); then
    echo "${kq:0:900}"
    # Route trả JSON có "error" khi Sheet đổi tên cột, mất quyền đọc, hay file rỗng. Đó là
    # hỏng THẬT — phải để unit đỏ, nếu không thì hỏng âm thầm cả tháng mà màn hình vẫn
    # hiện số cũ như số hôm nay.
    if printf '%s' "$kq" | grep -q '"error"'; then
        echo "→ nạp THẤT BẠI (xem thông báo ở trên)"
        rc=1
    fi
else
    echo "curl lỗi khi gọi $URL"
    rc=1
fi

# from/to chỉ giới hạn phần ghép thông tin khách từ BigQuery; đơn nào được đăng ký do
# planRegister quyết. MỖI thị trường một lượt, sổ riêng (Sỹ Anh chốt 25/09/2026: Singapore
# tách riêng Đài Loan): Đài trước, rồi các nước khai ở talpha_rules.json → tracking.markets —
# bảng đối tác của các nước đó talpha-sync đã nạp vào BigQuery mỗi giờ, không cần bước 1.
TU=$(TZ=Asia/Ho_Chi_Minh date -d '60 days ago' +%F)
DEN=$(TZ=Asia/Ho_Chi_Minh date +%F)
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NUOC_KHAC=$(python3 -c 'import json,sys; m=json.load(open(sys.argv[1]))["tracking"].get("markets",{}); print(" ".join(k for k,v in m.items() if not k.startswith("_") and isinstance(v,dict)))' \
    "$REPO/config/talpha_rules.json" 2>/dev/null || true)

dong_bo_17track() {   # $1 = mã nước ("" = Đài Loan)
    local mk="$1" ten="${1:-TW}" code kq17
    echo "── 2/2 · Đồng bộ 17TRACK · ${ten}"
    code=$(curl -sS -o /tmp/talpha-17track.json -w '%{http_code}' -X POST --max-time 600 \
        "${BASE}/api/talpha/tracking?from=${TU}&to=${DEN}${mk:+&market=$mk}") || code="000"
    kq17=$(cat /tmp/talpha-17track.json 2>/dev/null || true)
    rm -f /tmp/talpha-17track.json
    if [ "$code" = "428" ]; then
        echo "chưa có khoá TRACK17_API_KEY — bỏ qua 17TRACK, chỉ dùng bảng đối tác"
        return 0
    elif [ "$code" = "200" ]; then
        # Bỏ danh sách cảnh báo khỏi log (dài và có SĐT khách) — chỉ giữ phần số đếm.
        printf '%s' "$kq17" | python3 -c 'import json,sys; d=json.load(sys.stdin); d.pop("alerts",None); d.pop("counts",None); print(json.dumps(d,ensure_ascii=False)[:900])' \
            2>/dev/null || echo "${kq17:0:300}"
        # Hết quota KHÔNG làm unit đỏ: gói miễn phí hết giữa tháng là chuyện thường, đỏ mỗi
        # ngày thì chẳng ai nhìn nữa. Tin Zalo 08:00 đã nói rõ bao nhiêu đơn đang mù.
        if printf '%s' "$kq17" | grep -q '"quota_out":true'; then
            echo "→ 17TRACK hết quota — đơn còn lại theo bảng đối tác tới khi có quota"
        fi
        return 0
    fi
    echo "→ đồng bộ 17TRACK ${ten} THẤT BẠI (HTTP $code): ${kq17:0:300}"
    return 1
}

dong_bo_17track "" || rc=1
for MK in $NUOC_KHAC; do
    dong_bo_17track "$MK" || rc=1
done
exit $rc
