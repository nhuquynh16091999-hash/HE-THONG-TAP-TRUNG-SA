#!/usr/bin/env bash
#
# Cập nhật code trên máy chủ đã dựng sẵn. Chạy TRÊN MÁY CHỦ:
#     bash /opt/talpha/ops/deploy/vps-deploy.sh
#
# Dựng XONG mới khởi động lại — đúng thứ tự này là bắt buộc.
# Dựng lại trong khi pm2 đang phục vụ bản cũ thì mọi file chunk đổi tên, trang
# HTML cũ vẫn trỏ vào tên cũ, trình duyệt ném ChunkLoadError và người dùng thấy
# MÀN TRẮNG không thông báo gì. Đã dính thật trên máy Mac. Dựng XONG mới restart
# vẫn chưa đủ: `next build` xoá file cũ ngay từ đầu — nên dựng sang thư mục khác
# (ops/deploy/dashboard-slot.sh).
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/talpha}"

say() { printf '\n\033[1;33m▸ %s\033[0m\n' "$*"; }

say "Kéo code mới"
git -C "$APP_DIR" fetch --all --prune
BEFORE=$(git -C "$APP_DIR" rev-parse --short HEAD)
git -C "$APP_DIR" reset --hard origin/main
AFTER=$(git -C "$APP_DIR" rev-parse --short HEAD)
echo "   $BEFORE → $AFTER"
git -C "$APP_DIR" log --oneline -1

say "Cài gói"
cd "$APP_DIR/dashboard-ui"
. "$APP_DIR/ops/deploy/dashboard-slot.sh"
cai_goi

say "Chạy phép thử"
# Hỏng thì DỪNG, không đẩy bản lỗi ra cho cả đội.
npm test

say "Dựng bản chạy"
dung_ban_moi

say "Khởi động lại"
chuyen_sang_ban_moi
sleep 4
pm2 list

say "Kiểm tra"
code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/login || echo 000)
echo "   GET /login → HTTP $code"
[ "$code" = "200" ] || { echo "!! Dashboard không trả 200 — xem: pm2 logs talpha-dashboard" >&2; exit 1; }
say "XONG"
