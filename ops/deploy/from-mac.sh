#!/usr/bin/env bash
#
# Dựng dashboard TALPHA lên máy chủ, chạy TỪ MÁY MAC một phát ăn ngay.
#
#     bash ops/deploy/from-mac.sh
#
# Điều kiện: khoá SSH đã cài lên máy chủ. Kiểm bằng:
#     ssh -i ~/.ssh/id_ed25519_talpha_vps root@<ip> hostname
#
# Kịch bản này chỉ ĐIỀU KHIỂN. Việc nặng do vps-setup.sh làm trên máy chủ.
set -euo pipefail

HOST="${HOST:-139.180.131.21}"
KEY="${KEY:-$HOME/.ssh/id_ed25519_talpha_vps}"
APP_DIR="${APP_DIR:-/opt/talpha}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

SSH=(ssh -i "$KEY" -o IdentitiesOnly=yes -o ConnectTimeout=15 "root@$HOST")
SCP=(scp -i "$KEY" -o IdentitiesOnly=yes -q)

say() { printf '\n\033[1;33m▸ %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# ─────────────────────────────────────────────────────────────────────────
say "0/5 · Kiểm tra vào được máy chủ bằng khoá"
"${SSH[@]}" -o BatchMode=yes 'echo ok' >/dev/null 2>&1 \
    || die "Chưa vào được bằng khoá. Chạy trước: ssh-copy-id -i $KEY.pub root@$HOST"
"${SSH[@]}" 'echo "   $(hostname) · $(. /etc/os-release && echo $PRETTY_NAME) · $(nproc) CPU · $(free -m | awk "/Mem:/{print \$2}")MB RAM"'

# ─────────────────────────────────────────────────────────────────────────
say "1/5 · Chép cấu hình bí mật (không nằm trong git)"
[ -f "$REPO_ROOT/dashboard-ui/.env.local" ] || die "Thiếu dashboard-ui/.env.local ở máy Mac"
"${SSH[@]}" "mkdir -p $APP_DIR/dashboard-ui"
"${SCP[@]}" "$REPO_ROOT/dashboard-ui/.env.local" "root@$HOST:$APP_DIR/dashboard-ui/.env.local"
if [ -f "$REPO_ROOT/bigquery_key.json" ]; then
    "${SCP[@]}" "$REPO_ROOT/bigquery_key.json" "root@$HOST:$APP_DIR/bigquery_key.json"
fi
# Cấu hình chứa token Meta, khoá BigQuery — chỉ root đọc được.
"${SSH[@]}" "chmod 600 $APP_DIR/dashboard-ui/.env.local $APP_DIR/bigquery_key.json 2>/dev/null || true"
echo "   xong"

# ─────────────────────────────────────────────────────────────────────────
say "2/5 · Khoá deploy cho GitHub"
PUB=$("${SSH[@]}" '
    if [ ! -f ~/.ssh/id_ed25519_github ]; then
        ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519_github -C talpha-vps >/dev/null 2>&1
    fi
    grep -q "github.com" ~/.ssh/config 2>/dev/null || printf "Host github.com\n  IdentityFile ~/.ssh/id_ed25519_github\n  IdentitiesOnly yes\n  StrictHostKeyChecking accept-new\n" >> ~/.ssh/config
    cat ~/.ssh/id_ed25519_github.pub')

if "${SSH[@]}" 'ssh -T -o BatchMode=yes git@github.com 2>&1 | grep -q "successfully authenticated"'; then
    echo "   máy chủ đã đọc được repo"
else
    cat <<EOF

   ┌─────────────────────────────────────────────────────────────────┐
   │  CẦN LÀM TAY MỘT LẦN — máy chủ chưa đọc được repo riêng          │
   └─────────────────────────────────────────────────────────────────┘

   Mở: https://github.com/nhuquynh16091999-hash/HE-THONG-TAP-TRUNG-SA/settings/keys
   Bấm "Add deploy key", đặt tên "VPS talpha", dán nguyên dòng dưới đây:

$PUB

   KHÔNG cần tích "Allow write access" — máy chủ chỉ cần đọc.
   Dán xong chạy lại kịch bản này.

EOF
    exit 2
fi

# ─────────────────────────────────────────────────────────────────────────
say "3/5 · Dựng máy chủ (Node · pm2 · code · build · tường lửa)"
"${SCP[@]}" "$REPO_ROOT/ops/deploy/vps-setup.sh" "root@$HOST:/root/vps-setup.sh"
"${SSH[@]}" 'bash /root/vps-setup.sh'

# ─────────────────────────────────────────────────────────────────────────
say "4/5 · Nạp dữ liệu đối tác đã có sẵn ở máy Mac"
# Kho JSON (đơn từ file đối tác, sao kê COD đã tải) nằm ngoài git. Chép lên
# để máy chủ có số ngay, khỏi phải nạp lại tay.
if [ -d "$REPO_ROOT/data" ]; then
    "${SSH[@]}" "mkdir -p $APP_DIR/data"
    "${SCP[@]}" "$REPO_ROOT"/data/*.json "root@$HOST:$APP_DIR/data/" 2>/dev/null || true
    "${SSH[@]}" "ls -1 $APP_DIR/data/ | sed 's/^/   /'"
fi

# ─────────────────────────────────────────────────────────────────────────
say "5/5 · Kiểm tra"
"${SSH[@]}" 'pm2 list --no-color | tail -n +3'
code=$("${SSH[@]}" "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/login" || echo 000)
echo "   GET /login trong máy chủ → HTTP $code"
[ "$code" = "200" ] || die "Dashboard chưa lên. Xem: ssh -i $KEY root@$HOST 'pm2 logs talpha-dashboard --lines 40'"

ext=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "http://$HOST:3000/login" || echo 000)
echo "   GET /login từ ngoài   → HTTP $ext"

printf '\n\033[1;32m✓ XONG — http://%s:3000\033[0m\n\n' "$HOST"
echo "Còn nên làm:"
echo "  · Đổi mật khẩu root (mật khẩu cũ đã đi qua khung chat)"
echo "  · Tắt đăng nhập bằng mật khẩu — xem docs/DEPLOY_VPS.md"
echo "  · Gắn tên miền + HTTPS bằng nginx và certbot"
