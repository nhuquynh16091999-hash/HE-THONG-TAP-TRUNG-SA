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

# --push-data : ghi đè kho dữ liệu của MÁY CHỦ bằng bản trên máy Mac.
#   Chỉ dùng khi thật sự muốn thế (dựng lại máy chủ, hoặc phục hồi từ bản lưu).
#   Mặc định script HẠ bản của máy chủ về chứ không đẩy lên — xem bước 4/5.
PUSH_DATA=0
for arg in "$@"; do
    case "$arg" in
        --push-data) PUSH_DATA=1 ;;
        *) printf 'Tham số không hiểu: %s\n' "$arg" >&2; exit 2 ;;
    esac
done

HOST="${HOST:-139.180.131.21}"
KEY="${KEY:-$HOME/.ssh/id_ed25519_talpha_vps}"
APP_DIR="${APP_DIR:-/opt/talpha}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# -A cho máy chủ MƯỢN khoá GitHub của máy Mac trong lúc kết nối, thay vì phải
# cài khoá deploy riêng lên GitHub. Khoá không bao giờ nằm lại trên máy chủ —
# hết phiên là hết quyền.
GH_KEY="${GH_KEY:-$HOME/.ssh/id_ed25519_hethong}"
SSH=(ssh -A -i "$KEY" -o IdentitiesOnly=yes -o ConnectTimeout=15 "root@$HOST")
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

# systemd EnvironmentFile KHÔNG cắt ghi chú cuối dòng như bash: nó lấy nguyên
# phần sau dấu = làm giá trị. Dòng
#     TALPHA_META_ACCESS_TOKEN=EAA...   # hết hạn 06/11/2026
# thành một token dính đuôi ghi chú, và Meta trả "Malformed access token".
# Máy Mac vẫn chạy tốt vì bash cắt ghi chú — lỗi CHỈ hiện trên máy chủ, mà
# thông báo lại chẳng nhắc gì tới ghi chú. Đã mất một vòng gỡ vì chuyện này.
if grep -qE '^[A-Z0-9_]+=[^#]*[^ ]  *#' "$REPO_ROOT/dashboard-ui/.env.local"; then
    echo "   Các dòng có ghi chú ở đuôi:"
    grep -nE '^[A-Z0-9_]+=[^#]*[^ ]  *#' "$REPO_ROOT/dashboard-ui/.env.local" | cut -d= -f1
    die ".env.local có ghi chú cuối dòng — systemd sẽ nuốt cả vào giá trị. Chuyển ghi chú lên dòng riêng."
fi
"${SSH[@]}" "mkdir -p $APP_DIR/dashboard-ui"
"${SCP[@]}" "$REPO_ROOT/dashboard-ui/.env.local" "root@$HOST:$APP_DIR/dashboard-ui/.env.local"
if [ -f "$REPO_ROOT/bigquery_key.json" ]; then
    "${SCP[@]}" "$REPO_ROOT/bigquery_key.json" "root@$HOST:$APP_DIR/bigquery_key.json"
fi
# Cấu hình chứa token Meta, khoá BigQuery — chỉ root đọc được.
"${SSH[@]}" "chmod 600 $APP_DIR/dashboard-ui/.env.local $APP_DIR/bigquery_key.json 2>/dev/null || true"
echo "   xong"

# ─────────────────────────────────────────────────────────────────────────
say "2/5 · Cho máy chủ đọc được repo"
# Nạp khoá GitHub vào agent của máy Mac để chuyển tiếp sang máy chủ.
ssh-add -l 2>/dev/null | grep -q "$(ssh-keygen -lf "$GH_KEY" | awk '{print $2}')" \
    || ssh-add "$GH_KEY" 2>/dev/null \
    || die "Không nạp được $GH_KEY vào ssh-agent"

# Cấu hình cũ trên máy chủ có thể ép dùng khoá riêng của nó — bỏ đi để khoá
# mượn qua agent được dùng.
"${SSH[@]}" 'sed -i "/^Host github.com/,+3d" ~/.ssh/config 2>/dev/null || true'

if "${SSH[@]}" 'ssh -T -o BatchMode=yes -o StrictHostKeyChecking=accept-new git@github.com 2>&1 | grep -q "successfully authenticated"'; then
    echo "   máy chủ đọc được repo (mượn khoá của máy Mac)"
else
    die "Máy chủ vẫn không đọc được repo. Xem mục 'Khoá deploy' trong docs/DEPLOY_VPS.md"
fi

say "3/5 · Dựng máy chủ (Node · pm2 · code · build · tường lửa)"
"${SCP[@]}" "$REPO_ROOT/ops/deploy/vps-setup.sh" "root@$HOST:/root/vps-setup.sh"
"${SSH[@]}" 'bash /root/vps-setup.sh'

# ─────────────────────────────────────────────────────────────────────────
say "4/5 · Kho dữ liệu người dùng nhập trên dashboard"
#
# ĐÂY LÀ DỮ LIỆU CỦA MÁY CHỦ, KHÔNG PHẢI CỦA MÁY MAC.
#
# `data/*.json` là thứ người dùng tải lên qua dashboard: sao kê COD, bản kê chi
# phí TKQC, bảng đơn đối tác. Nơi sinh ra chúng là MÁY CHỦ.
#
# Bản trước của script này chép Mac → máy chủ mỗi lần deploy, nên mọi file người
# dùng tải lên sau lần deploy gần nhất đều bị xoá sạch và thay bằng bản cũ trên
# máy Mac. Suýt mất thật 12/09/2026: sao kê "ĐỐI SOÁT COD 2026.9.11" (60 dòng)
# được tải lên lúc 17:08, lần deploy trước đó xong lúc 17:01 — thoát trong sáu
# phút. Deploy thêm một lần nữa là bản sao kê đó bốc hơi, và không ai biết cho
# tới lúc mở tab Đối soát ra thấy thiếu một kỳ.
#
# Nay mặc định là HẠ VỀ: lấy bản của máy chủ xuống làm bản lưu, KHÔNG đẩy lên.
# Chỉ đẩy lên khi máy chủ chưa có gì (dựng mới), hoặc khi gọi tay --push-data.
LUU="$REPO_ROOT/data-backup-$(date +%Y%m%d-%H%M%S)"
CO_TREN_MAY_CHU=$("${SSH[@]}" "ls $APP_DIR/data/*.json 2>/dev/null | wc -l" | tr -d ' \r')

if [ "${PUSH_DATA:-0}" = "1" ]; then
    [ -d "$REPO_ROOT/data" ] || die "--push-data nhưng máy Mac không có thư mục data/"
    if [ "$CO_TREN_MAY_CHU" -gt 0 ]; then
        echo "   máy chủ đang có $CO_TREN_MAY_CHU file — lưu lại trước khi ghi đè"
        mkdir -p "$LUU" && "${SCP[@]}" "root@$HOST:$APP_DIR/data/*.json" "$LUU/" \
            || die "Không lưu được bản của máy chủ — DỪNG, không ghi đè."
        echo "   đã lưu vào $LUU"
    fi
    echo "   ĐẨY LÊN (bạn đã yêu cầu --push-data)"
    "${SSH[@]}" "mkdir -p $APP_DIR/data"
    # KHÔNG nuốt lỗi: deploy trượt mà báo xong là kiểu hỏng đắt nhất.
    "${SCP[@]}" "$REPO_ROOT"/data/*.json "root@$HOST:$APP_DIR/data/" \
        || die "Chép kho dữ liệu lên máy chủ THẤT BẠI — máy chủ đang giữ số cũ."
elif [ "$CO_TREN_MAY_CHU" -eq 0 ] && [ -d "$REPO_ROOT/data" ]; then
    echo "   máy chủ chưa có kho nào — nạp lần đầu từ máy Mac"
    "${SSH[@]}" "mkdir -p $APP_DIR/data"
    "${SCP[@]}" "$REPO_ROOT"/data/*.json "root@$HOST:$APP_DIR/data/" \
        || die "Nạp kho dữ liệu lần đầu THẤT BẠI."
else
    echo "   giữ nguyên kho của máy chủ ($CO_TREN_MAY_CHU file) — không ghi đè"
    mkdir -p "$LUU" && "${SCP[@]}" "root@$HOST:$APP_DIR/data/*.json" "$LUU/" \
        && echo "   đã hạ về bản lưu: $LUU" \
        || echo "   ⚠️  không hạ được bản lưu (kho máy chủ vẫn nguyên)"
fi
"${SSH[@]}" "ls -l $APP_DIR/data/*.json 2>/dev/null | awk '{printf \"   %-28s %s byte\\n\", \$9, \$5}'"

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
