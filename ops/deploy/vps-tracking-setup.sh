#!/usr/bin/env bash
#
# Dựng việc nền NẠP BẢNG ĐƠN ĐỐI TÁC — mỗi sáng 6h giờ Việt Nam, đọc Google Sheet của
# NAZA vào kho `tracking` để Sổ đơn hàng và màn Đối soát COD tự cập nhật. Từ 25/09/2026
# cùng lượt đó đồng bộ luôn 17TRACK (có khoá TRACK17_API_KEY mới chạy) — bot Zalo đọc kết
# quả lúc 08:00 để gửi tin "Vận đơn cần xử lý".
#
# Chạy TRÊN MÁY CHỦ:
#     bash /opt/talpha/ops/deploy/vps-tracking-setup.sh
#
# Vì sao có: tới 16/09/2026 kho này CHỈ đổi khi có người bấm "Đọc bảng đối tác" trên
# dashboard. Lần nạp gần nhất khi đó là 09/09 — bảy ngày không ai bấm, mà màn Đối soát
# COD vẫn hiện số cũ y như số hôm nay. Sỹ Anh chốt 16/09/2026: chạy tự động 6h sáng.
#
# KHÔNG tự tải được sao kê NAZA: họ gửi file .xlsx qua chat, không có nguồn nào để lấy.
# Thay vào đó màn Đối soát COD tự nhắc ở mục "Việc hôm nay" khi tới kỳ mà chưa có file
# (luật saoKeTreHan; chu kỳ khai ở talpha_rules.json → cod_settlement.statement_cycle_days).
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/talpha}"
PORT="${PORT:-3000}"
RUNNER="$APP_DIR/ops/deploy/tracking-import.sh"

say() { printf '\n\033[1;33m▸ %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[ -f "$RUNNER" ] || die "Thiếu $RUNNER — chạy ops/deploy/from-mac.sh trước."
curl -s -o /dev/null -m 10 "http://127.0.0.1:${PORT}/login" \
    || die "Dashboard không trả lời ở cổng ${PORT} — route nhập là của nó. Chạy from-mac.sh trước."

# ─────────────────────────────────────────────────────────────────────────
say "1/3 · Dịch vụ systemd"
cat > /etc/systemd/system/talpha-tracking.service <<EOF
[Unit]
Description=TALPHA — nạp bảng đơn đối tác (Google Sheet NAZA) + đồng bộ 17TRACK
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
Environment=PORT=${PORT}
ExecStart=/bin/bash ${RUNNER}
# Nạp Sheet tối đa 5' + đồng bộ 17TRACK tối đa 10'.
TimeoutStartSec=960
StandardOutput=journal
StandardError=journal
EOF

cat > /etc/systemd/system/talpha-tracking.timer <<'EOF'
[Unit]
Description=Nạp bảng đơn đối tác + đồng bộ 17TRACK: 6h sáng và 21:30 tối (giờ Việt Nam)

[Timer]
# systemd 252 đọc được múi giờ ngay trong OnCalendar, nên viết thẳng giờ Việt Nam thay
# vì tự quy ra 23:00 UTC — quy tay là sớm muộn có ngày sửa nhầm.
OnCalendar=*-*-* 06:00:00 Asia/Ho_Chi_Minh
# 21:30 (Sỹ Anh duyệt bản tin 26/09/2026): tin vận đơn 22:00 chấm "khách phải gọi sáng nay
# đã lấy chưa" — cần 17TRACK hỏi lại trạng thái trước đó (hỏi trạng thái miễn phí).
OnCalendar=*-*-* 21:30:00 Asia/Ho_Chi_Minh
RandomizedDelaySec=120
# Máy chủ tắt ngang giờ đó thì chạy bù khi bật lại, chứ không bỏ luôn ngày hôm ấy.
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now talpha-tracking.timer
echo "   đã bật"

# ─────────────────────────────────────────────────────────────────────────
say "2/3 · Chạy thử một lần ngay"
systemctl start talpha-tracking.service || true
journalctl -u talpha-tracking -n 8 --no-pager | tail -6

# ─────────────────────────────────────────────────────────────────────────
say "3/3 · Lịch chạy tới"
systemctl list-timers 'talpha-*' --no-pager | head -5

printf '\n\033[1;32m✓ XONG\033[0m\n\n'
echo "Xem nhật ký : journalctl -u talpha-tracking -n 40 --no-pager"
echo "Chạy tay    : systemctl start talpha-tracking"
