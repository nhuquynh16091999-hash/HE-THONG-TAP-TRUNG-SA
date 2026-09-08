#!/usr/bin/env bash
#
# Dựng dashboard TALPHA trên máy chủ Linux sạch.
#
# Chạy TRÊN MÁY CHỦ, một lần duy nhất:
#     bash vps-setup.sh
#
# Sau đó mỗi lần cập nhật code chỉ cần:
#     bash ops/deploy/vps-deploy.sh
#
# Chạy được trên CẢ HAI họ: RHEL/CentOS/Rocky (dnf + firewalld) và
# Debian/Ubuntu (apt + ufw). Máy hiện tại là CentOS Stream 9 — viết cứng theo
# apt như bản đầu là chết ngay dòng đầu.
#
# KHÔNG chứa mật khẩu hay khoá nào. Secrets đi riêng bằng scp.
set -euo pipefail

REPO_URL="${REPO_URL:-git@github.com:nhuquynh16091999-hash/HE-THONG-TAP-TRUNG-SA.git}"
APP_DIR="${APP_DIR:-/opt/talpha}"
NODE_MAJOR="${NODE_MAJOR:-22}"
PORT="${PORT:-3000}"

say()  { printf '\n\033[1;33m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;35m  ! %s\033[0m\n' "$*"; }

# ─────────────────────────────────────────────────────────────────────────
say "0/8 · Nhận dạng máy"
if command -v dnf >/dev/null 2>&1; then
    PKG=dnf; FW=firewalld
elif command -v apt-get >/dev/null 2>&1; then
    PKG=apt; FW=ufw
else
    echo "!! Không nhận ra trình quản lý gói (không có dnf lẫn apt-get)." >&2; exit 1
fi
. /etc/os-release
echo "   $PRETTY_NAME · gói: $PKG · tường lửa: $FW"

pkg_install() {
    if [ "$PKG" = dnf ]; then dnf install -y -q "$@"
    else DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$@"; fi
}

# ─────────────────────────────────────────────────────────────────────────
say "1/8 · Gói hệ thống"
if [ "$PKG" = dnf ]; then dnf makecache -q || true
else apt-get update -qq; fi
pkg_install curl git ca-certificates tar

# ─────────────────────────────────────────────────────────────────────────
say "2/8 · Bộ nhớ tạm (swap)"
# `next build` ngốn quãng 1,5–2GB. Máy 1GB RAM mà không có swap thì build bị
# nhân hệ điều hành giết giữa chừng, và thông báo lỗi chẳng nhắc gì tới bộ nhớ
# — chỉ thấy "Killed", rất khó đoán ra nguyên nhân.
RAM_MB=$(free -m | awk '/Mem:/{print $2}')
SWAP_MB=$(free -m | awk '/Swap:/{print $2}')
echo "   RAM ${RAM_MB}MB · swap ${SWAP_MB}MB"
if [ "$RAM_MB" -lt 2048 ] && [ "$SWAP_MB" -lt 2048 ]; then
    warn "RAM thấp và chưa đủ swap — tạo 2GB swap"
    fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
    chmod 600 /swapfile && mkswap -q /swapfile && swapon /swapfile
    grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
    free -m | awk '/Swap:/{print "   swap giờ: "$2"MB"}'
fi

# ─────────────────────────────────────────────────────────────────────────
say "3/8 · Node.js $NODE_MAJOR"
need_node=1
if command -v node >/dev/null 2>&1 && [ "$(node -v | cut -c2- | cut -d. -f1)" -ge "$NODE_MAJOR" ]; then
    need_node=0
fi
if [ "$need_node" = 1 ]; then
    if [ "$PKG" = dnf ]; then
        curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
        dnf install -y -q nodejs
    else
        curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
        apt-get install -y -qq nodejs
    fi
fi
echo "   node $(node -v) · npm $(npm -v)"

# ─────────────────────────────────────────────────────────────────────────
say "4/8 · pm2"
command -v pm2 >/dev/null 2>&1 || npm install -g pm2 --silent
echo "   pm2 $(pm2 -v)"
mkdir -p /var/log/talpha

# ─────────────────────────────────────────────────────────────────────────
say "5/8 · Mã nguồn → $APP_DIR"
# Khoá deploy phải cài trước; from-mac.sh lo việc đó và dừng lại nếu chưa có.
if [ -d "$APP_DIR/.git" ]; then
    git -C "$APP_DIR" fetch --all --prune
    git -C "$APP_DIR" reset --hard origin/main
else
    mkdir -p "$(dirname "$APP_DIR")"
    # Cấu hình bí mật đã được chép lên trước khi có repo, nên thư mục đích
    # không rỗng — git clone thẳng vào sẽ từ chối. Clone ra chỗ khác rồi dời.
    TMP=$(mktemp -d)
    git clone --depth 50 "$REPO_URL" "$TMP/repo"
    mkdir -p "$APP_DIR"
    ( cd "$TMP/repo" && tar cf - . ) | ( cd "$APP_DIR" && tar xf - )
    rm -rf "$TMP"
fi
echo "   $(git -C "$APP_DIR" log --oneline -1)"

# ─────────────────────────────────────────────────────────────────────────
say "6/8 · Cài gói và dựng bản chạy"
cd "$APP_DIR/dashboard-ui"
if [ ! -f .env.local ]; then
    echo "!! THIẾU dashboard-ui/.env.local — chép lên trước rồi chạy lại." >&2
    exit 1
fi
npm ci --no-audit --no-fund
# Chặn trần bộ nhớ của Node dưới mức RAM+swap để build không bị giết đột ngột.
NODE_OPTIONS="--max-old-space-size=1536" npm run build

# ─────────────────────────────────────────────────────────────────────────
say "7/8 · pm2 khởi chạy + bật lại khi máy reboot"
cd "$APP_DIR"
pm2 delete talpha-dashboard >/dev/null 2>&1 || true
pm2 start ops/pm2/ecosystem.vps.config.js --only talpha-dashboard
pm2 save

# Chạy với quyền root thì pm2 tự tạo luôn dịch vụ systemd, rồi in thêm một dòng
# gợi ý cách gỡ: "$ pm2 unstartup systemd". Bản trước đem `| tail -1 | bash`
# dòng đó nên bash kêu "$: command not found" — trông như dựng hỏng trong khi
# thật ra đã xong. Chạy thẳng rồi tự kiểm bằng systemctl mới biết chắc.
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true
if systemctl is-enabled pm2-root >/dev/null 2>&1; then
    echo "   dịch vụ pm2-root đã bật — máy khởi động lại dashboard tự lên"
else
    warn "pm2-root CHƯA bật — máy reboot là dashboard không tự chạy lại"
fi

# ─────────────────────────────────────────────────────────────────────────
say "8/8 · Tường lửa"
# Mở SSH TRƯỚC rồi mới bật tường lửa. Ngược thứ tự là tự khoá mình ra ngoài,
# phải vào console của nhà cung cấp mới gỡ được.
if [ "$FW" = firewalld ]; then
    systemctl enable --now firewalld >/dev/null 2>&1 || true
    firewall-cmd --permanent --add-service=ssh   >/dev/null
    firewall-cmd --permanent --add-port=$PORT/tcp >/dev/null
    firewall-cmd --reload >/dev/null
    echo "   mở: $(firewall-cmd --list-services) · cổng $(firewall-cmd --list-ports)"
else
    ufw allow 22/tcp >/dev/null; ufw allow "$PORT"/tcp >/dev/null
    ufw --force enable >/dev/null; ufw status | head -5
fi

say "XONG"
echo "   Kiểm tra:  curl -I http://127.0.0.1:$PORT/login"
echo "   Nhật ký :  pm2 logs talpha-dashboard"
